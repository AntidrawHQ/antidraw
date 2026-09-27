import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { SiteUploadError } from "../protocol/errors";
import { resolveLimits, type Limits } from "../protocol/limits";
import { parseManifest, pathProblem, type Files, type Manifest } from "../protocol/manifest";

export type LocalFile = { path: string; absPath: string; size: number };

export type HashedFile = LocalFile & { hash: string };

export type LocalSite = {
  manifest: Manifest;
  /** One local file per hash, to upload from. */
  sources: Map<string, HashedFile>;
  totalBytes: number;
};

export type BuildManifestOptions = {
  limits?: Partial<Limits>;
  /** Marks files that can be cached forever, such as hashed build output. */
  immutable?: (path: string) => boolean;
  hashConcurrency?: number;
  signal?: AbortSignal;
  onHashed?: (file: HashedFile) => void;
};

/**
 * Every regular file under `dir`, with forward-slash NFC paths. Symlinks and
 * special files are refused rather than skipped, so the site never silently
 * differs from the folder.
 */
export async function listFiles(dir: string): Promise<LocalFile[]> {
  const root = await stat(dir);
  if (!root.isDirectory()) {
    throw new SiteUploadError("UNSUPPORTED_FILE", `${dir} is not a folder`);
  }
  const files: LocalFile[] = [];
  const walk = async (absDir: string, segments: string[]) => {
    for (const entry of await readdir(absDir, { withFileTypes: true })) {
      const absPath = join(absDir, entry.name);
      const parts = [...segments, entry.name.normalize("NFC")];
      const path = parts.join("/");
      if (entry.isSymbolicLink()) {
        throw new SiteUploadError("UNSUPPORTED_FILE", `${path} is a symlink`, { path });
      }
      if (entry.isDirectory()) {
        await walk(absPath, parts);
      } else if (entry.isFile()) {
        files.push({ path, absPath, size: (await lstat(absPath)).size });
      } else {
        throw new SiteUploadError("UNSUPPORTED_FILE", `${path} is not a regular file`, { path });
      }
    }
  };
  await walk(dir, []);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Checks paths and limits before any hashing, so an oversized folder fails in
 * milliseconds instead of after reading gigabytes.
 */
export function checkLocalFiles(files: LocalFile[], limits: Limits): void {
  if (files.length === 0) throw new SiteUploadError("INVALID_MANIFEST", "The folder has no files");
  if (files.length > limits.maxFiles) {
    throw new SiteUploadError(
      "TOO_LARGE",
      `${files.length} files is over the ${limits.maxFiles}-file limit`,
      { reason: "files", limit: limits.maxFiles, actual: files.length },
    );
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const problem = pathProblem(file.path, limits.maxPathBytes);
    if (problem) {
      throw new SiteUploadError("INVALID_MANIFEST", `Path ${JSON.stringify(file.path)} ${problem}`, {
        path: file.path,
      });
    }
    if (seen.has(file.path)) {
      throw new SiteUploadError(
        "INVALID_MANIFEST",
        `Two files have the same name after Unicode normalization: ${file.path}`,
        { path: file.path },
      );
    }
    seen.add(file.path);
    if (file.size > limits.maxFileBytes) {
      throw new SiteUploadError(
        "TOO_LARGE",
        `${file.path} is ${file.size} bytes, over the ${limits.maxFileBytes}-byte file limit`,
        { reason: "file", path: file.path, limit: limits.maxFileBytes, actual: file.size },
      );
    }
    total += file.size;
  }
  if (total > limits.maxTotalBytes) {
    const largest = [...files]
      .sort((a, b) => b.size - a.size)
      .slice(0, 5)
      .map(({ path, size }) => ({ path, size }));
    throw new SiteUploadError(
      "TOO_LARGE",
      `The folder is ${total} bytes, over the ${limits.maxTotalBytes}-byte limit`,
      { reason: "total", limit: limits.maxTotalBytes, actual: total, largest },
    );
  }
}

/** sha256 of a file, streamed. Fails if the size changed since it was listed. */
export async function hashFile(absPath: string, expectedSize: number, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(absPath, { signal }) as AsyncIterable<Buffer>) {
    size += chunk.length;
    hash.update(chunk);
  }
  if (size !== expectedSize) {
    throw new SiteUploadError("FILE_CHANGED", `${absPath} changed while it was being read`, {
      path: absPath,
    });
  }
  return hash.digest("hex");
}

/** Lists, checks and hashes `dir` into a manifest ready to plan. */
export async function buildManifest(dir: string, options: BuildManifestOptions = {}): Promise<LocalSite> {
  const limits = resolveLimits(options.limits);
  const files = await listFiles(dir);
  checkLocalFiles(files, limits);

  const hashed = await mapLimit(files, options.hashConcurrency ?? 4, async (file) => {
    options.signal?.throwIfAborted();
    const result = { ...file, hash: await hashFile(file.absPath, file.size, options.signal) };
    options.onHashed?.(result);
    return result;
  });

  const raw: Files = Object.create(null);
  const sources = new Map<string, HashedFile>();
  let totalBytes = 0;
  for (const file of hashed) {
    raw[file.path] = options.immutable?.(file.path)
      ? { h: file.hash, s: file.size, i: true }
      : { h: file.hash, s: file.size };
    if (!sources.has(file.hash)) sources.set(file.hash, file);
    totalBytes += file.size;
  }
  return { manifest: parseManifest({ v: 1, files: raw }, limits), sources, totalBytes };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

import { SiteUploadError } from "./errors";
import { DEFAULT_LIMITS, type Limits } from "./limits";

/**
 * h: sha256 of the file's bytes (lowercase hex). s: size in bytes.
 * i: the file can be cached forever (a build output with a hash in its name).
 */
export type FileEntry = { h: string; s: number; i?: true };

/** Path → entry. Always a null-prototype object, so any path is a safe key. */
export type Files = Record<string, FileEntry>;

export type Manifest = { v: 1; files: Files };

export type PlanResult = { missing: string[] };

export type CommitResult = {
  publishId: string;
  previous: string | null;
  alreadyCommitted: boolean;
};

const HASH_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// Control characters, backslash, and lone surrogates. A lone surrogate has no
// UTF-8 form, so no URL could ever request that path.
const BAD_CHAR_RE = /[\u0000-\u001f\u007f\\]|\p{Surrogate}/u;
const encoder = new TextEncoder();

export const isHash = (value: unknown): value is string =>
  typeof value === "string" && HASH_RE.test(value);

/** Site keys and publish ids: they become R2 key segments. */
export const isId = (value: unknown): value is string =>
  typeof value === "string" && ID_RE.test(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Why `path` can't be a site path, or null when it can. */
export function pathProblem(path: string, maxBytes: number): string | null {
  if (path.length === 0) return "is empty";
  if (BAD_CHAR_RE.test(path)) return "contains a control character, backslash or invalid UTF-16";
  if (encoder.encode(path).length > maxBytes) return `is longer than ${maxBytes} bytes`;
  if (path !== path.normalize("NFC")) return "is not NFC-normalized";
  for (const segment of path.split("/")) {
    if (segment === "") return "has an empty segment";
    if (segment === "." || segment === "..") return "has a . or .. segment";
  }
  return null;
}

// Sorting with "/" as the lowest character puts every "a/..." path directly
// after "a", so file/folder clashes are adjacent pairs.
const sortKey = (path: string) => path.replaceAll("/", "\u0000");

/** Validates untrusted manifest JSON and returns it in canonical form. */
export function parseManifest(input: unknown, limits: Limits = DEFAULT_LIMITS): Manifest {
  const invalid = (message: string, details?: Record<string, unknown>) =>
    new SiteUploadError("INVALID_MANIFEST", message, details);

  if (!isObject(input) || input.v !== 1) throw invalid("Manifest must be an object with v: 1");
  const raw = input.files;
  if (!isObject(raw)) throw invalid("Manifest files must be an object");

  const paths = Object.keys(raw);
  if (paths.length === 0) throw invalid("Manifest has no files");
  if (paths.length > limits.maxFiles) {
    throw new SiteUploadError(
      "TOO_LARGE",
      `${paths.length} files is over the ${limits.maxFiles}-file limit`,
      { reason: "files", limit: limits.maxFiles, actual: paths.length },
    );
  }

  const sizeOf = new Map<string, number>();
  let total = 0;
  for (const path of paths) {
    const problem = pathProblem(path, limits.maxPathBytes);
    if (problem) throw invalid(`Path ${JSON.stringify(path)} ${problem}`, { path });

    const entry = raw[path];
    if (!isObject(entry) || !isHash(entry.h)) {
      throw invalid(`${path}: h must be a lowercase sha256 hex digest`, { path });
    }
    const size = entry.s;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw invalid(`${path}: s must be a non-negative integer`, { path });
    }
    if (entry.i !== undefined && entry.i !== true) {
      throw invalid(`${path}: i must be true when present`, { path });
    }
    if (size > limits.maxFileBytes) {
      throw new SiteUploadError(
        "TOO_LARGE",
        `${path} is ${size} bytes, over the ${limits.maxFileBytes}-byte file limit`,
        { reason: "file", path, limit: limits.maxFileBytes, actual: size },
      );
    }
    const known = sizeOf.get(entry.h);
    if (known !== undefined && known !== size) {
      throw invalid(`${path}: the same hash appears with two different sizes`, { path });
    }
    sizeOf.set(entry.h, size);
    total += size;
  }
  if (total > limits.maxTotalBytes) {
    throw new SiteUploadError(
      "TOO_LARGE",
      `The site is ${total} bytes, over the ${limits.maxTotalBytes}-byte limit`,
      { reason: "total", limit: limits.maxTotalBytes, actual: total },
    );
  }

  const keyed = paths.map((path) => [sortKey(path), path] as const);
  keyed.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i + 1 < keyed.length; i++) {
    const [key, path] = keyed[i]!;
    if (keyed[i + 1]![0].startsWith(`${key}\u0000`)) {
      throw invalid(`${path} is both a file and a folder`, { path });
    }
  }

  const files: Files = Object.create(null);
  for (const [, path] of keyed) {
    const entry = raw[path] as FileEntry;
    files[path] = entry.i ? { h: entry.h, s: entry.s, i: true } : { h: entry.h, s: entry.s };
  }
  return { v: 1, files };
}

/** Unique hashes in a manifest with their sizes. */
export function hashSizes(files: Files): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const path in files) {
    const entry = files[path]!;
    sizes.set(entry.h, entry.s);
  }
  return sizes;
}

/** Canonical manifests (from parseManifest) compare equal by their JSON. */
export const sameFiles = (a: Files, b: Files) => JSON.stringify(a) === JSON.stringify(b);

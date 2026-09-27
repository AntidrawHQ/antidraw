import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { err, ok, type Result } from "neverthrow";
import { pack as tarPack } from "tar-stream";
import { isExcludedSnapshotPath, isSafeSnapshotPath } from "./paths";
import {
  MAX_MANIFEST_BYTES,
  type ManifestEntry,
  type PackedBlob,
  type PackedSnapshot,
  type SnapshotError,
  type SnapshotManifest,
  type StagedSnapshot,
} from "./types";
import { HAS_NOFOLLOW, READ_NOFOLLOW, byteCompare, errorMessage, nativePath } from "./util";

export const MANIFEST_ENTRY = "manifest.json";
export const FILES_PREFIX = "files/";
const GZIP_OS_OFFSET = 9;
const GZIP_OS_UNKNOWN = 0xff;

class PackFailure extends Error {}
class PackCancelled extends Error {}

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw new PackCancelled("Snapshot cancelled");
};

// zlib writes the OS byte of the gzip header from the build platform; pin it so the same tree
// gives the same bytes everywhere. zlib already writes MTIME = 0
const pinGzipOs = () => {
  let offset = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (offset <= GZIP_OS_OFFSET && GZIP_OS_OFFSET < offset + chunk.length) {
        chunk = Buffer.from(chunk);
        chunk[GZIP_OS_OFFSET - offset] = GZIP_OS_UNKNOWN;
      }
      offset += chunk.length;
      cb(null, chunk);
    },
  });
};

const hashTap = (hash: ReturnType<typeof createHash>, counter: { bytes: number }) =>
  new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      hash.update(chunk);
      counter.bytes += chunk.length;
      cb(null, chunk);
    },
  });

const sha256Hex = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const hashFile = async (file: string): Promise<{ size: number; sha256: string }> => {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: hash.digest("hex") };
};

// Reads a staged archive file (always < LARGE_FILE_BYTES) and proves it still matches the manifest
const readStaged = async (dir: string, entry: ManifestEntry): Promise<Buffer> => {
  const file = nativePath(dir, entry.path);
  if (!HAS_NOFOLLOW && !(await fs.lstat(file)).isFile()) throw new PackFailure(`${entry.path} is not a regular file`);
  const handle = await fs.open(file, READ_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      throw new PackFailure(`${entry.path} changed after staging`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

const writeArchive = async (staged: StagedSnapshot, manifestJson: Buffer, archiveFile: string, signal?: AbortSignal) => {
  const hash = createHash("sha256");
  const counter = { bytes: 0 };
  const pack = tarPack();
  const written = pipeline(
    pack,
    zlib.createGzip({ level: 9 }),
    pinGzipOs(),
    hashTap(hash, counter),
    createWriteStream(archiveFile, { flags: "wx", mode: 0o600 }),
  );
  // Surface a pipeline failure to whichever entry is waiting, and never leave it unhandled
  const failed = written.then(
    () => new Promise<never>(() => {}),
    (e: unknown) => Promise.reject(e),
  );
  failed.catch(() => {});

  const addEntry = (name: string, bytes: Buffer, mode: number) =>
    Promise.race([
      failed,
      new Promise<void>((resolve, reject) => {
        pack.entry(
          { name, size: bytes.length, mode, mtime: new Date(0), uid: 0, gid: 0, uname: "", gname: "", type: "file" },
          bytes,
          (e) => (e ? reject(e) : resolve()),
        );
      }),
    ]);

  try {
    // manifest.json first, for every file including blobs; then the archive files in manifest order
    await addEntry(MANIFEST_ENTRY, manifestJson, 0o644);
    for (const entry of staged.manifest.files) {
      if (entry.storage !== "archive") continue;
      throwIfAborted(signal);
      await addEntry(FILES_PREFIX + entry.path, await readStaged(staged.dir, entry), entry.mode);
    }
    pack.finalize();
  } catch (e) {
    pack.destroy(e instanceof Error ? e : new Error(String(e)));
    await written.catch(() => {});
    throw e;
  }
  await written;
  return { archiveSha256: hash.digest("hex"), archiveSize: counter.bytes };
};

// Private copies of the blob files: the build that runs next may write into the staged tree, but
// it cannot change what is uploaded
const copyBlobs = async (staged: StagedSnapshot, blobDir: string, signal?: AbortSignal): Promise<PackedBlob[]> => {
  const bySha = new Map<string, ManifestEntry[]>();
  for (const entry of staged.manifest.files) {
    if (entry.storage !== "blob") continue;
    const group = bySha.get(entry.sha256);
    if (group) group.push(entry);
    else bySha.set(entry.sha256, [entry]);
  }

  const blobs: PackedBlob[] = [];
  for (const sha256 of [...bySha.keys()].sort()) {
    throwIfAborted(signal);
    const group = bySha.get(sha256) ?? [];
    const [first] = group;
    if (!first) continue;
    const src = nativePath(staged.dir, first.path);
    if (!(await fs.lstat(src)).isFile()) throw new PackFailure(`${first.path} is not a regular file`);
    const file = nativePath(blobDir, sha256);
    await fs.copyFile(src, file, fsConstants.COPYFILE_FICLONE | fsConstants.COPYFILE_EXCL);
    const copied = await hashFile(file);
    if (copied.sha256 !== sha256 || copied.size !== first.size) {
      throw new PackFailure(`${first.path} changed after staging`);
    }
    blobs.push({ sha256, size: first.size, file, paths: group.map((e) => e.path).sort(byteCompare) });
  }
  return blobs;
};

// Deterministic .tar.gz of the staged snapshot plus private blob copies. `archiveFile` and
// `blobDir` must not exist; blobDir is created 0700. Byte and file limits are the caller's to
// enforce; the manifest.json cap is enforced here (TOO_LARGE), since extract refuses any archive
// over it. A cancel is noticed between archive entries and between blob copies
export const packSnapshot = async (
  staged: StagedSnapshot,
  out: { archiveFile: string; blobDir: string },
  opts?: { signal?: AbortSignal },
): Promise<Result<PackedSnapshot, SnapshotError>> => {
  const unsafe = staged.manifest.files.filter((f) => !isSafeSnapshotPath(f.path) || isExcludedSnapshotPath(f.path));
  if (unsafe.length > 0) {
    return err({ code: "PACK_FAILED", message: "Snapshot contains paths that are not allowed", paths: unsafe.map((f) => f.path) });
  }
  const sorted = [...staged.manifest.files].sort((a, b) => byteCompare(a.path, b.path));
  const manifest: SnapshotManifest = { version: 1, files: sorted };
  const input: StagedSnapshot = { ...staged, manifest };
  const manifestJson = Buffer.from(JSON.stringify(manifest));
  if (manifestJson.length > MAX_MANIFEST_BYTES) {
    return err({
      code: "TOO_LARGE",
      message: `manifest.json would be ${manifestJson.length} bytes, more than ${MAX_MANIFEST_BYTES}`,
    });
  }

  if (await fs.lstat(out.archiveFile).then(() => true, () => false)) {
    return err({ code: "PACK_FAILED", message: `Archive file already exists: ${out.archiveFile}` });
  }
  try {
    await fs.mkdir(out.blobDir, { mode: 0o700 });
  } catch (e) {
    return err({ code: "PACK_FAILED", message: `Couldn't create the blob directory: ${errorMessage(e)}` });
  }

  try {
    throwIfAborted(opts?.signal);
    const { archiveSha256, archiveSize } = await writeArchive(input, manifestJson, out.archiveFile, opts?.signal);
    const blobs = await copyBlobs(input, out.blobDir, opts?.signal);
    return ok({
      archiveFile: out.archiveFile,
      archiveSha256,
      archiveSize,
      blobs,
      snapshotBytes: archiveSize + blobs.reduce((sum, b) => sum + b.size, 0),
      uncompressedBytes: sorted.reduce((sum, f) => sum + f.size, 0),
      fileCount: sorted.length,
      manifest,
    });
  } catch (e) {
    await Promise.all([
      fs.rm(out.archiveFile, { force: true }),
      fs.rm(out.blobDir, { recursive: true, force: true }),
    ]);
    if (e instanceof PackCancelled) return err({ code: "CANCELLED", message: e.message });
    return err({ code: "PACK_FAILED", message: `Couldn't pack the snapshot: ${errorMessage(e)}` });
  }
};

// The biggest files, for the "too large" panel: of a manifest, or of a scan plan
export const largestFiles = (
  list: { files: readonly { path: string; size: number }[] },
  n = 10,
): { path: string; size: number }[] =>
  [...list.files]
    .sort((a, b) => b.size - a.size || byteCompare(a.path, b.path))
    .slice(0, n)
    .map(({ path, size }) => ({ path, size }));

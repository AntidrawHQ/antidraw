import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { err, ok, type Result } from "neverthrow";
import { extract as tarExtract } from "tar-stream";
import { z } from "zod";
import { FILES_PREFIX, MANIFEST_ENTRY } from "./pack";
import { caseKey, isExcludedSnapshotPath, isSafeSnapshotPath } from "./paths";
import {
  MAX_MANIFEST_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_UNCOMPRESSED_BYTES,
  type ExtractError,
  type ExtractedSnapshot,
  type ManifestEntry,
  type SnapshotManifest,
} from "./types";
import { errorMessage, isMissing, nativePath } from "./util";

// Gunzipped bytes allowed beyond the declared content: tar headers, pax records and padding.
// Anything past it is a decompression bomb or a buffered pax header, and extraction stops
const BASE_SLACK_BYTES = 1024 * 1024;
const ENTRY_SLACK_BYTES = 8 * 1024;

const manifestSchema = z.object({
  version: z.literal(1),
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      mode: z.union([z.literal(0o644), z.literal(0o755)]),
      storage: z.enum(["archive", "blob"]),
    }),
  ),
});

class ExtractFailure extends Error {
  constructor(readonly failure: ExtractError) {
    super(failure.message);
  }
}

function fail(code: ExtractError["code"], message: string, p?: string): never {
  throw new ExtractFailure({ code, message, ...(p !== undefined && { path: p }) });
}

type Limits = { maxBytes: number; maxFiles: number };

// Checks the manifest as a whole, before any other entry or blob is read
const parseManifest = (bytes: Buffer, limits: Limits): SnapshotManifest => {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail("INVALID_ARCHIVE", "manifest.json is not valid JSON");
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) return fail("INVALID_ARCHIVE", "manifest.json does not describe a snapshot");
  const manifest: SnapshotManifest = parsed.data;

  if (manifest.files.length > limits.maxFiles) {
    fail("TOO_LARGE", `Snapshot has ${manifest.files.length} files, more than ${limits.maxFiles}`);
  }
  const total = manifest.files.reduce((sum, f) => sum + f.size, 0);
  if (total > limits.maxBytes) fail("TOO_LARGE", `Snapshot unpacks to ${total} bytes, more than ${limits.maxBytes}`);

  const paths = new Set<string>();
  const keys = new Map<string, string>();
  const blobSizes = new Map<string, number>();
  for (const f of manifest.files) {
    // Remix opens the result with Claude Code, git and npm, so anything scan would exclude
    // (.claude hooks, .git/config, node_modules, .env*, credentials) is refused, not skipped
    if (!isSafeSnapshotPath(f.path)) fail("UNSAFE_ENTRY", `Unsafe path in snapshot: ${f.path}`, f.path);
    if (isExcludedSnapshotPath(f.path)) fail("UNSAFE_ENTRY", `Snapshot contains an excluded path: ${f.path}`, f.path);
    if (paths.has(f.path)) fail("DUPLICATE_ENTRY", `Duplicate path in snapshot: ${f.path}`, f.path);
    paths.add(f.path);
    const key = caseKey(f.path);
    const other = keys.get(key);
    if (other !== undefined) fail("CASE_COLLISION", `${f.path} and ${other} differ only by case`, f.path);
    keys.set(key, f.path);
    if (f.storage === "blob") {
      const size = blobSizes.get(f.sha256);
      if (size !== undefined && size !== f.size) fail("MANIFEST_MISMATCH", `Blob ${f.sha256} has two sizes`, f.path);
      blobSizes.set(f.sha256, f.size);
    }
  }
  // A path that is also a directory of another path cannot be written
  for (const f of manifest.files) {
    const segments = caseKey(f.path).split("/");
    for (let i = 1; i < segments.length; i++) {
      const dir = keys.get(segments.slice(0, i).join("/"));
      if (dir !== undefined) fail("UNSAFE_ENTRY", `${dir} is both a file and a directory`, dir);
    }
  }
  return manifest;
};

// Counts gunzipped bytes against a budget that grows only with what the manifest and the tar
// headers declare
class ByteBudget extends Transform {
  total = 0;
  limit = BASE_SLACK_BYTES;

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.total += chunk.length;
    if (this.total > this.limit) {
      cb(new ExtractFailure({ code: "TOO_LARGE", message: "Archive unpacks to more data than it declares" }));
    } else {
      cb(null, chunk);
    }
  }
}

type ArchiveVisitor = {
  // Consumes the whole entry and throws an ExtractFailure when its bytes do not match `expected`
  onFile(p: string, expected: ManifestEntry, entry: AsyncIterable<Buffer>): Promise<void>;
};

type PaxHeaders = { pax?: Record<string, string> };

const readManifestEntry = async (entry: AsyncIterable<Buffer>, size: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let read = 0;
  for await (const chunk of entry) {
    read += chunk.length;
    if (read > size || read > MAX_MANIFEST_BYTES) fail("TOO_LARGE", "manifest.json is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const toExtractError = (e: unknown): ExtractError =>
  e instanceof ExtractFailure ? e.failure : { code: "INVALID_ARCHIVE", message: `Invalid archive: ${errorMessage(e)}` };

// Streams gunzip → tar and validates every entry against the manifest. With no visitor it stops
// after the manifest. Returns the manifest and the sha256 of its bytes
const readArchive = async (
  archiveFile: string,
  limits: Limits,
  visitor?: ArchiveVisitor,
): Promise<{ manifest: SnapshotManifest; manifestSha256: string }> => {
  const source = createReadStream(archiveFile);
  const budget = new ByteBudget();
  const extract = tarExtract();
  const piped = pipeline(source, zlib.createGunzip(), budget).catch((e: unknown) => {
    extract.destroy(e instanceof Error ? e : new Error(String(e)));
  });
  budget.pipe(extract);

  let manifest: SnapshotManifest | undefined;
  let manifestSha256 = "";
  const archived = new Map<string, ManifestEntry>();
  const seen = new Set<string>();
  let total = 0;
  let count = 0;

  try {
    for await (const entry of extract) {
      const header = entry.header;
      const size = header.size ?? 0;
      // tar-stream applies pax records itself; a global one, or any key besides the path, could
      // change how the entry reads, and pack never writes them
      if ((extract as unknown as { _paxGlobal: unknown })._paxGlobal) {
        fail("UNSUPPORTED_ENTRY", "Archive contains a pax global header");
      }
      const pax = (header as PaxHeaders).pax;
      if (pax && Object.keys(pax).some((k) => k !== "path")) {
        fail("UNSUPPORTED_ENTRY", `Unsupported pax header on ${header.name}`, header.name);
      }

      if (!manifest) {
        if (header.name !== MANIFEST_ENTRY || header.type !== "file") {
          fail("INVALID_ARCHIVE", "manifest.json must be the first entry of the archive", header.name);
        }
        // Checked before any byte of it is buffered; it counts toward maxBytes
        if (size > MAX_MANIFEST_BYTES || size > limits.maxBytes) fail("TOO_LARGE", "manifest.json is too large");
        budget.limit += size + ENTRY_SLACK_BYTES;
        const bytes = await readManifestEntry(entry as AsyncIterable<Buffer>, size);
        manifest = parseManifest(bytes, limits);
        manifestSha256 = createHash("sha256").update(bytes).digest("hex");
        total = size;
        for (const f of manifest.files) if (f.storage === "archive") archived.set(f.path, f);
        if (!visitor) return { manifest, manifestSha256 };
        continue;
      }

      const name = header.name;
      if (header.type !== "file") fail("UNSUPPORTED_ENTRY", `Unsupported ${header.type} entry: ${name}`, name);
      if (!name.startsWith(FILES_PREFIX)) fail("UNSAFE_ENTRY", `Unexpected entry: ${name}`, name);
      const p = name.slice(FILES_PREFIX.length);
      if (!isSafeSnapshotPath(p) || isExcludedSnapshotPath(p)) fail("UNSAFE_ENTRY", `Unsafe entry: ${name}`, name);
      if (seen.has(p)) fail("DUPLICATE_ENTRY", `Duplicate entry: ${name}`, p);
      seen.add(p);

      count++;
      total += size;
      if (count > limits.maxFiles || total > limits.maxBytes) fail("TOO_LARGE", "Archive holds more than it may");

      const expected = archived.get(p);
      if (!expected) fail("MANIFEST_MISMATCH", `${p} is not an archive file of the manifest`, p);
      if (expected.size !== size || ((header.mode ?? 0) & 0o7777) !== expected.mode) {
        fail("MANIFEST_MISMATCH", `${p} does not match its manifest entry`, p);
      }
      budget.limit += size + ENTRY_SLACK_BYTES;
      await visitor?.onFile(p, expected, entry as AsyncIterable<Buffer>);
    }

    if (!manifest) return fail("INVALID_ARCHIVE", "Archive is empty");
    for (const p of archived.keys()) {
      if (!seen.has(p)) fail("MANIFEST_MISMATCH", `${p} is missing from the archive`, p);
    }
    return { manifest, manifestSha256 };
  } finally {
    source.destroy();
    budget.destroy();
    extract.destroy();
    await piped;
  }
};

// Hashes a stream's bytes, optionally writing them, and requires the expected size and sha256
const verifyStream = async (
  p: string,
  expected: { size: number; sha256: string },
  chunks: AsyncIterable<Buffer>,
  out?: FileHandle,
) => {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of chunks) {
    hash.update(chunk);
    size += chunk.length;
    if (size > expected.size) fail("CHECKSUM_MISMATCH", `${p} is larger than its manifest entry`, p);
    if (out) await out.write(chunk);
  }
  if (size !== expected.size || hash.digest("hex") !== expected.sha256) {
    fail("CHECKSUM_MISMATCH", `${p} does not match its checksum`, p);
  }
};

const blobEntries = (manifest: SnapshotManifest) => manifest.files.filter((f) => f.storage === "blob");

const resolveBlob = (blobFile: (sha256: string) => string | undefined, entry: ManifestEntry): string => {
  const file = blobFile(entry.sha256);
  if (!file) return fail("MISSING_BLOB", `Missing blob for ${entry.path}`, entry.path);
  return file;
};

const openBlob = async (file: string, entry: ManifestEntry) => {
  const stats = await fs.stat(file).catch((e: unknown) => {
    if (isMissing(e)) return fail("MISSING_BLOB", `Missing blob for ${entry.path}`, entry.path);
    throw e;
  });
  if (!stats.isFile() || stats.size !== entry.size) {
    fail("CHECKSUM_MISMATCH", `Blob for ${entry.path} does not match its checksum`, entry.path);
  }
  return createReadStream(file);
};

// Writes one file of the partial tree: exclusive create, hashed while written
const writeVerified = async (root: string, p: string, expected: ManifestEntry, chunks: AsyncIterable<Buffer>) => {
  const dest = nativePath(root, p);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const out = await fs.open(dest, "wx", expected.mode);
  try {
    await verifyStream(p, expected, chunks, out);
    await out.chmod(expected.mode); // the umask may have narrowed the open mode
  } finally {
    await out.close();
  }
};

const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

// Validates the whole archive and every blob first (pass 1, writes nothing), then writes into
// `${destDir}.partial-<rand>`, re-verifying every byte, and renames it into place. `destDir` must
// not exist; nothing is ever written into an existing directory
export const extractSnapshot = async (input: {
  archiveFile: string;
  blobFile: (sha256: string) => string | undefined;
  destDir: string;
  maxBytes?: number;
  maxFiles?: number;
}): Promise<Result<ExtractedSnapshot, ExtractError>> => {
  const limits = { maxBytes: input.maxBytes ?? MAX_UNCOMPRESSED_BYTES, maxFiles: input.maxFiles ?? MAX_SNAPSHOT_FILES };
  const destDir = path.resolve(input.destDir);

  if (await exists(destDir)) return err({ code: "DEST_EXISTS", message: `${destDir} already exists` });

  // Pass 1: validate, write nothing
  let manifest: SnapshotManifest;
  let manifestSha256: string;
  try {
    ({ manifest, manifestSha256 } = await readArchive(input.archiveFile, limits, {
      onFile: (p, expected, entry) => verifyStream(p, expected, entry),
    }));
    const checked = new Set<string>();
    for (const entry of blobEntries(manifest)) {
      if (checked.has(entry.sha256)) continue;
      checked.add(entry.sha256);
      const file = resolveBlob(input.blobFile, entry);
      await verifyStream(entry.path, entry, await openBlob(file, entry));
    }
  } catch (e) {
    return err(toExtractError(e));
  }

  // Pass 2: write into a partial directory next to the destination
  const partial = `${destDir}.partial-${randomBytes(6).toString("hex")}`;
  try {
    await fs.mkdir(partial);
  } catch (e) {
    return err({ code: "WRITE_FAILED", message: `Couldn't create ${partial}: ${errorMessage(e)}` });
  }

  try {
    // The archive is read again, so it is validated again: a file swapped between the passes
    // fails its checksum instead of being written
    const second = await readArchive(input.archiveFile, limits, {
      onFile: (p, expected, entry) => writeVerified(partial, p, expected, entry),
    });
    if (second.manifestSha256 !== manifestSha256) fail("MANIFEST_MISMATCH", "Archive changed during extraction");
    for (const entry of blobEntries(manifest)) {
      const file = resolveBlob(input.blobFile, entry);
      await writeVerified(partial, entry.path, entry, await openBlob(file, entry));
    }

    if (await exists(destDir)) fail("DEST_EXISTS", `${destDir} already exists`);
    await fs.rename(partial, destDir);
  } catch (e) {
    await fs.rm(partial, { recursive: true, force: true });
    if (e instanceof ExtractFailure) return err(e.failure);
    return err({ code: "WRITE_FAILED", message: `Couldn't write the snapshot: ${errorMessage(e)}` });
  }

  return ok({
    dir: destDir,
    manifest,
    fileCount: manifest.files.length,
    bytes: manifest.files.reduce((sum, f) => sum + f.size, 0),
  });
};

// Reads and validates only the manifest (the first entry), with the default limits
export const readSnapshotManifest = async (archiveFile: string): Promise<Result<SnapshotManifest, ExtractError>> => {
  try {
    const { manifest } = await readArchive(archiveFile, {
      maxBytes: MAX_UNCOMPRESSED_BYTES,
      maxFiles: MAX_SNAPSHOT_FILES,
    });
    return ok(manifest);
  } catch (e) {
    return err(toExtractError(e));
  }
};

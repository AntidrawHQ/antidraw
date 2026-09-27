import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pack as tarPack, extract as tarExtract, type Header } from "tar-stream";
import type { FileMode, ManifestEntry, SnapshotManifest } from "../types";

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

// Temp dirs, removed by cleanupTmp() in afterEach
const tmpDirs: string[] = [];
export const makeTmp = (prefix = "snapshot-test-"): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
};
export const cleanupTmp = () => {
  for (const dir of tmpDirs.splice(0)) {
    // Restore permissions a test may have removed, so rm can recurse
    try {
      fs.chmodSync(dir, 0o755);
    } catch {
      // gone already
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export type TreeNode = string | Buffer | { content: string | Buffer; mode?: number } | { symlink: string };

// Writes files (creating parents) and symlinks; a symlink target is used verbatim
export const writeTree = (root: string, tree: Record<string, TreeNode>) => {
  for (const [rel, node] of Object.entries(tree)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (typeof node === "object" && !Buffer.isBuffer(node) && "symlink" in node) {
      fs.symlinkSync(node.symlink, abs);
    } else if (typeof node === "object" && !Buffer.isBuffer(node)) {
      fs.writeFileSync(abs, node.content);
      if (node.mode !== undefined) fs.chmodSync(abs, node.mode);
    } else {
      fs.writeFileSync(abs, node);
    }
  }
};

// Every file under `root` (following nothing), as relative POSIX path → { content, mode }
export const readTree = (root: string): Record<string, { content: Buffer; mode: number }> => {
  const out: Record<string, { content: Buffer; mode: number }> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        out[rel] = { content: fs.readFileSync(abs), mode: fs.lstatSync(abs).mode & 0o777 };
      }
    }
  };
  walk(root);
  return out;
};

// True when `dir` is on a case-insensitive filesystem (APFS and NTFS defaults)
export const isCaseInsensitive = (dir: string): boolean => {
  const probe = path.join(dir, "CaseProbe");
  fs.writeFileSync(probe, "");
  try {
    return fs.existsSync(path.join(dir, "caseprobe"));
  } finally {
    fs.rmSync(probe);
  }
};

// ----------------------------------------------------------------------------
// Archive builders (for hostile archives)
// ----------------------------------------------------------------------------

export type ArchiveFile = { path: string; content: Buffer | string; mode?: FileMode; storage?: "archive" | "blob" };

export const manifestEntry = (f: ArchiveFile): ManifestEntry => {
  const content = Buffer.from(f.content);
  return {
    path: f.path,
    size: content.length,
    sha256: sha256(content),
    mode: f.mode ?? 0o644,
    storage: f.storage ?? "archive",
  };
};

export const manifestOf = (files: ArchiveFile[]): SnapshotManifest => ({ version: 1, files: files.map(manifestEntry) });

export type RawEntry = { header: Partial<Header> & Pick<Header, "name">; content?: Buffer | string };

export const fileEntry = (name: string, content: Buffer | string, mode = 0o644): RawEntry => ({
  header: { name, mode, type: "file", mtime: new Date(0) },
  content,
});

export const manifestJsonEntry = (manifest: unknown): RawEntry => fileEntry("manifest.json", JSON.stringify(manifest));

// A tar of exactly these entries, in this order, built with tar-stream
export const packTar = async (entries: RawEntry[]): Promise<Buffer> => {
  const pack = tarPack();
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    pack.on("data", (c) => {
      chunks.push(c as Buffer);
    });
    pack.on("end", resolve);
    pack.on("error", reject);
  });
  for (const e of entries) {
    await new Promise<void>((resolve, reject) => {
      const body = e.content === undefined ? undefined : Buffer.from(e.content);
      const cb = (err?: Error | null) => (err ? reject(err) : resolve());
      // Entries without a body (links, directories, devices) finish on their own
      if (body) pack.entry(e.header, body, cb);
      else pack.entry(e.header, cb);
    });
  }
  pack.finalize();
  await done;
  return Buffer.concat(chunks);
};

export const writeGzip = (file: string, ...parts: Buffer[]) => fs.writeFileSync(file, zlib.gzipSync(Buffer.concat(parts)));

// A gzipped tar of exactly these entries, optionally followed by raw bytes inside the gzip stream
export const buildArchive = async (file: string, entries: RawEntry[], trailing?: Buffer): Promise<void> => {
  writeGzip(file, await packTar(entries), ...(trailing ? [trailing] : []));
};

// One raw tar record: a hand-encoded header plus its body padded to 512 bytes
export const rawTarRecord = (name: string, body: Buffer, typeflag = "0"): Buffer =>
  Buffer.concat([rawTarHeader(name, body.length, typeflag), body, Buffer.alloc((512 - (body.length % 512)) % 512)]);

// A valid archive of `files` (blob entries go only in the manifest); returns blob contents by sha
export const buildSnapshotArchive = async (file: string, files: ArchiveFile[]): Promise<Map<string, Buffer>> => {
  const blobs = new Map<string, Buffer>();
  const entries: RawEntry[] = [manifestJsonEntry(manifestOf(files))];
  for (const f of files) {
    if ((f.storage ?? "archive") === "blob") blobs.set(sha256(f.content), Buffer.from(f.content));
    else entries.push(fileEntry(`files/${f.path}`, f.content, f.mode ?? 0o644));
  }
  await buildArchive(file, entries);
  return blobs;
};

// A hand-encoded ustar header, for headers tar-stream would refuse to write (e.g. a size the
// body does not have)
export const rawTarHeader = (name: string, size: number, typeflag = "0"): Buffer => {
  const buf = Buffer.alloc(512);
  const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, "0") + "\0";
  buf.write(name, 0);
  buf.write(octal(0o644, 8), 100);
  buf.write(octal(0, 8), 108);
  buf.write(octal(0, 8), 116);
  buf.write(octal(size, 12), 124);
  buf.write(octal(0, 12), 136);
  buf.write("        ", 148);
  buf.write(typeflag, 156);
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return buf;
};

// Header fields of every entry of a .tar.gz, in order
export const listArchive = async (file: string): Promise<{ header: Header; content: Buffer }[]> => {
  const extract = tarExtract();
  const out: { header: Header; content: Buffer }[] = [];
  const done = (async () => {
    for await (const entry of extract) {
      const chunks: Buffer[] = [];
      for await (const c of entry as AsyncIterable<Buffer>) chunks.push(c);
      out.push({ header: entry.header, content: Buffer.concat(chunks) });
    }
  })();
  extract.end(zlib.gunzipSync(fs.readFileSync(file)));
  await done;
  return out;
};

// Leftovers next to a destination: the destination itself or any `.partial-*` sibling
export const leftovers = (destDir: string): string[] => {
  const parent = path.dirname(destDir);
  const base = path.basename(destDir);
  return fs.readdirSync(parent).filter((n) => n === base || n.startsWith(`${base}.partial-`));
};

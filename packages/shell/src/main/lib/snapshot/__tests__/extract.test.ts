import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, test, vi } from "vitest";
import { extractSnapshot, readSnapshotManifest } from "../extract";
import { packSnapshot } from "../pack";
import { scanWorkspace } from "../scan";
import { stageSnapshot } from "../stage";
import { LARGE_FILE_BYTES, MAX_MANIFEST_BYTES, type ExtractError } from "../types";
import {
  buildArchive,
  buildDeepManifestArchive,
  buildSnapshotArchive,
  cleanupTmp,
  fileEntry,
  leftovers,
  makeTmp,
  manifestEntry,
  manifestJsonEntry,
  manifestOf,
  packTar,
  rawTarHeader,
  rawTarRecord,
  readTree,
  sha256,
  writeTree,
  writeGzip,
  type ArchiveFile,
  type RawEntry,
} from "./helpers";

afterEach(cleanupTmp);

const extractFrom = async (archiveFile: string, blobs = new Map<string, Buffer>(), opts?: { maxBytes?: number; maxFiles?: number }) => {
  const work = makeTmp();
  const blobPaths = new Map<string, string>();
  for (const [sha, content] of blobs) {
    const file = path.join(work, sha);
    fs.writeFileSync(file, content);
    blobPaths.set(sha, file);
  }
  const destDir = path.join(work, "remix", "source");
  fs.mkdirSync(path.dirname(destDir));
  const blobFile = vi.fn((sha: string) => blobPaths.get(sha));
  const result = await extractSnapshot({ archiveFile, blobFile, destDir, ...opts });
  return { result, destDir, blobFile };
};

// Asserts the error code and that nothing was left behind
const expectRejected = async (
  archiveFile: string,
  code: ExtractError["code"],
  blobs?: Map<string, Buffer>,
  opts?: { maxBytes?: number; maxFiles?: number },
) => {
  const { result, destDir, blobFile } = await extractFrom(archiveFile, blobs, opts);
  expect(result.isErr(), JSON.stringify(result)).toBe(true);
  expect(result._unsafeUnwrapErr().code).toBe(code);
  expect(leftovers(destDir)).toEqual([]);
  return { error: result._unsafeUnwrapErr(), blobFile };
};

const archivePath = () => path.join(makeTmp(), "snapshot.tar.gz");

const snapshotArchive = async (files: ArchiveFile[]) => {
  const file = archivePath();
  const blobs = await buildSnapshotArchive(file, files);
  return { file, blobs };
};

const valid: ArchiveFile[] = [
  { path: "package.json", content: "{}" },
  { path: "src/app.ts", content: "export {}" },
];

describe("extractSnapshot round trip", () => {
  test("scan → stage → pack → extract gives an identical tree and modes", async () => {
    const source = makeTmp();
    writeTree(source, {
      ".gitignore": "*.log\n",
      "package.json": '{"name":"x"}',
      "src/app.tsx": "export default () => null;\n",
      "bin/run.sh": { content: "#!/bin/sh\n", mode: 0o755 },
      "public/big.bin": Buffer.alloc(LARGE_FILE_BYTES + 3, 5),
      "public/big-copy.bin": Buffer.alloc(LARGE_FILE_BYTES + 3, 5),
      "public/other.bin": { content: Buffer.alloc(LARGE_FILE_BYTES, 6), mode: 0o755 },
      "empty.txt": "",
      "ünïcode/файл.txt": "y",
    });
    const plan = (await scanWorkspace(source))._unsafeUnwrap();
    const staging = makeTmp();
    const staged = (await stageSnapshot(plan, path.join(staging, "source")))._unsafeUnwrap();
    const packed = (
      await packSnapshot(staged, { archiveFile: path.join(staging, "s.tar.gz"), blobDir: path.join(staging, "blobs") })
    )._unsafeUnwrap();

    const destDir = path.join(makeTmp(), "source");
    const blobFile = (sha: string) => packed.blobs.find((b) => b.sha256 === sha)?.file;
    const result = await extractSnapshot({ archiveFile: packed.archiveFile, blobFile, destDir });
    const extracted = result._unsafeUnwrap();

    expect(extracted.dir).toBe(destDir);
    expect(extracted.fileCount).toBe(9);
    expect(extracted.bytes).toBe(packed.uncompressedBytes);
    expect(extracted.manifest).toEqual(packed.manifest);
    // Compared by digest: a deep toEqual over MiB buffers is slow
    const digest = (dir: string) =>
      Object.fromEntries(Object.entries(readTree(dir)).map(([p, f]) => [p, { sha: sha256(f.content), mode: f.mode }]));
    expect(digest(destDir)).toEqual(digest(source));
    expect(leftovers(destDir)).toEqual(["source"]);

    expect((await readSnapshotManifest(packed.archiveFile))._unsafeUnwrap()).toEqual(packed.manifest);
  });

  test("a hand-built valid archive extracts", async () => {
    const { file, blobs } = await snapshotArchive([
      ...valid,
      { path: "run.sh", content: "#!/bin/sh", mode: 0o755 },
      { path: "big.bin", content: Buffer.alloc(LARGE_FILE_BYTES, 1), storage: "blob" },
    ]);
    const { result, destDir } = await extractFrom(file, blobs);
    expect(result.isOk()).toBe(true);
    expect(fs.statSync(path.join(destDir, "run.sh")).mode & 0o777).toBe(0o755);
    expect(sha256(fs.readFileSync(path.join(destDir, "big.bin")))).toBe(sha256(Buffer.alloc(LARGE_FILE_BYTES, 1)));
  });
});

describe("extractSnapshot rejects hostile archives and leaves nothing behind", () => {
  test("manifest path ../evil → UNSAFE_ENTRY", async () => {
    const { file } = await snapshotArchive([{ path: "../evil", content: "x" }]);
    await expectRejected(file, "UNSAFE_ENTRY");
  });

  test("manifest path /abs → UNSAFE_ENTRY", async () => {
    const { file } = await snapshotArchive([{ path: "/abs", content: "x" }]);
    await expectRejected(file, "UNSAFE_ENTRY");
  });

  test("tar entry files/a/../../x → UNSAFE_ENTRY", async () => {
    const file = archivePath();
    await buildArchive(file, [manifestJsonEntry(manifestOf(valid)), fileEntry("files/a/../../x", "x")]);
    await expectRejected(file, "UNSAFE_ENTRY");
  });

  test("tar entry ../evil outside files/ → UNSAFE_ENTRY", async () => {
    const file = archivePath();
    await buildArchive(file, [manifestJsonEntry(manifestOf(valid)), fileEntry("../evil", "x")]);
    await expectRejected(file, "UNSAFE_ENTRY");
  });

  test.each<[string, RawEntry]>([
    ["symlink", { header: { name: "files/link", type: "symlink", linkname: "/etc/passwd" } }],
    ["hardlink", { header: { name: "files/hard", type: "link", linkname: "files/package.json" } }],
    ["directory", { header: { name: "files/dir/", type: "directory" } }],
    ["fifo", { header: { name: "files/fifo", type: "fifo" } }],
    ["character device", { header: { name: "files/dev", type: "character-device" } }],
  ])("%s entry → UNSUPPORTED_ENTRY", async (_label, entry) => {
    const file = archivePath();
    await buildArchive(file, [manifestJsonEntry(manifestOf(valid)), entry]);
    await expectRejected(file, "UNSUPPORTED_ENTRY");
  });

  test("duplicate tar entry → DUPLICATE_ENTRY", async () => {
    const file = archivePath();
    await buildArchive(file, [
      manifestJsonEntry(manifestOf(valid)),
      fileEntry("files/package.json", "{}"),
      fileEntry("files/package.json", "{}"),
      fileEntry("files/src/app.ts", "export {}"),
    ]);
    await expectRejected(file, "DUPLICATE_ENTRY");
  });

  test("duplicate manifest path → DUPLICATE_ENTRY", async () => {
    const { file } = await snapshotArchive([...valid, { path: "package.json", content: "{}" }]);
    await expectRejected(file, "DUPLICATE_ENTRY");
  });

  test("case-colliding manifest → CASE_COLLISION", async () => {
    const { file } = await snapshotArchive([
      { path: "README.md", content: "a" },
      { path: "Readme.md", content: "b" },
    ]);
    await expectRejected(file, "CASE_COLLISION");
  });

  test("a path that is both a file and a directory → UNSAFE_ENTRY", async () => {
    const { file } = await snapshotArchive([
      { path: "a", content: "file" },
      { path: "a/b", content: "nested" },
    ]);
    await expectRejected(file, "UNSAFE_ENTRY");
  });

  test("a file that is a directory of a path sorted away from it, or of another case → UNSAFE_ENTRY", async () => {
    // "a-b" sorts between "a" and "a/b" by code unit
    const apart = await snapshotArchive([
      { path: "a", content: "file" },
      { path: "a-b", content: "sibling" },
      { path: "a/b/c", content: "nested" },
    ]);
    const { error } = await expectRejected(apart.file, "UNSAFE_ENTRY");
    expect(error.path).toBe("a");

    const cased = archivePath();
    const manifest = manifestOf([
      { path: "A", content: "file" },
      { path: "a/b", content: "nested" },
    ]);
    await buildArchive(cased, [manifestJsonEntry(manifest), fileEntry("files/A", "file"), fileEntry("files/a/b", "nested")]);
    await expectRejected(cased, "UNSAFE_ENTRY");
  });

  test("paths that only share a name prefix are not directories of each other", async () => {
    const files: ArchiveFile[] = [
      { path: "a", content: "1" },
      { path: "a-b/c", content: "2" },
      { path: "ab/c", content: "3" },
      { path: "a.b", content: "4" },
      { path: "b/a", content: "5" },
      { path: "b/a-", content: "6" },
    ];
    const { file } = await snapshotArchive(files);
    const { result, destDir } = await extractFrom(file);
    expect(result._unsafeUnwrap().fileCount).toBe(files.length);
    expect(Object.keys(readTree(destDir)).sort()).toEqual(files.map((f) => f.path).sort());
  });

  test("validating a manifest takes time linear in the depth of its paths", async () => {
    // Checking every prefix of every path is quadratic in depth, and extract runs in the main
    // process: a manifest of 4000 paths 510 deep took over 4 s in one block. Two depths are
    // compared rather than one bounded: 8× the depth costs under 8× when linear (about 35× when
    // quadratic). Each side is the least CPU time of several interleaved runs, which other
    // processes on a busy machine do not stretch. That validation yields between files is
    // asserted in extract-yield.test.ts
    const count = 500;
    const shallow = archivePath();
    const deep = archivePath();
    await buildDeepManifestArchive(shallow, 63, count);
    await buildDeepManifestArchive(deep, 508, count);
    const cpuTimeToRead = async (file: string) => {
      const start = process.cpuUsage();
      expect((await readSnapshotManifest(file))._unsafeUnwrap().files).toHaveLength(count);
      const { user, system } = process.cpuUsage(start);
      return user + system;
    };
    await cpuTimeToRead(deep); // warm-up
    let fastestShallow = Infinity;
    let fastestDeep = Infinity;
    for (let run = 0; run < 5; run++) {
      fastestShallow = Math.min(fastestShallow, await cpuTimeToRead(shallow));
      fastestDeep = Math.min(fastestDeep, await cpuTimeToRead(deep));
    }
    expect(fastestDeep / fastestShallow).toBeLessThan(16);

    const { error } = await expectRejected(deep, "MANIFEST_MISMATCH");
    expect(error.message).toMatch(/missing from the archive/);
  }, 30_000);

  test("a manifest swapped between the passes → MANIFEST_MISMATCH, even one pass 1 would refuse", async () => {
    const { file, blobs } = await snapshotArchive([
      ...valid,
      { path: "big.bin", content: Buffer.alloc(LARGE_FILE_BYTES), storage: "blob" },
    ]);
    // Pass 2 does not parse the manifest again, so one it would refuse is caught by its hash
    const hostile = manifestOf(valid);
    hostile.files.push({ path: ".git/config", size: 0, sha256: sha256(""), mode: 0o644, storage: "archive" });
    const swapIn = archivePath();
    await buildArchive(swapIn, [
      manifestJsonEntry(hostile),
      fileEntry("files/package.json", "{}"),
      fileEntry("files/src/app.ts", "export {}"),
      fileEntry("files/.git/config", ""),
    ]);

    const work = makeTmp();
    const blobPaths = new Map<string, string>();
    for (const [sha, content] of blobs) {
      blobPaths.set(sha, path.join(work, sha));
      fs.writeFileSync(path.join(work, sha), content);
    }
    const destDir = path.join(work, "remix", "source");
    fs.mkdirSync(path.dirname(destDir));
    // Pass 1 resolves the blob once it has read the whole archive
    let swapped = false;
    const blobFile = (sha: string) => {
      if (!swapped) fs.copyFileSync(swapIn, file);
      swapped = true;
      return blobPaths.get(sha);
    };

    const result = await extractSnapshot({ archiveFile: file, blobFile, destDir });
    expect(swapped).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "MANIFEST_MISMATCH", message: "Archive changed during extraction" });
    expect(leftovers(destDir)).toEqual([]);
  });

  test("content that does not match the manifest sha → CHECKSUM_MISMATCH", async () => {
    const file = archivePath();
    const manifest = manifestOf(valid);
    manifest.files[1]!.sha256 = sha256("other bytes");
    await buildArchive(file, [
      manifestJsonEntry(manifest),
      fileEntry("files/package.json", "{}"),
      fileEntry("files/src/app.ts", "export {}"),
    ]);
    await expectRejected(file, "CHECKSUM_MISMATCH");
  });

  test("an entry whose size or mode differs from the manifest → MANIFEST_MISMATCH", async () => {
    const sized = archivePath();
    await buildArchive(sized, [
      manifestJsonEntry(manifestOf(valid)),
      fileEntry("files/package.json", "{ }"),
      fileEntry("files/src/app.ts", "export {}"),
    ]);
    await expectRejected(sized, "MANIFEST_MISMATCH");

    const moded = archivePath();
    await buildArchive(moded, [
      manifestJsonEntry(manifestOf(valid)),
      fileEntry("files/package.json", "{}", 0o755),
      fileEntry("files/src/app.ts", "export {}"),
    ]);
    await expectRejected(moded, "MANIFEST_MISMATCH");
  });

  test("an archive entry missing, or not in the manifest → MANIFEST_MISMATCH", async () => {
    const missing = archivePath();
    await buildArchive(missing, [manifestJsonEntry(manifestOf(valid)), fileEntry("files/package.json", "{}")]);
    await expectRejected(missing, "MANIFEST_MISMATCH");

    const extra = archivePath();
    await buildArchive(extra, [
      manifestJsonEntry(manifestOf(valid)),
      fileEntry("files/package.json", "{}"),
      fileEntry("files/src/app.ts", "export {}"),
      fileEntry("files/extra.txt", "x"),
    ]);
    await expectRejected(extra, "MANIFEST_MISMATCH");
  });

  test("a missing blob → MISSING_BLOB", async () => {
    const { file } = await snapshotArchive([...valid, { path: "big.bin", content: Buffer.alloc(LARGE_FILE_BYTES), storage: "blob" }]);
    await expectRejected(file, "MISSING_BLOB", new Map());
  });

  test("a blob with the wrong bytes → CHECKSUM_MISMATCH", async () => {
    const content = Buffer.alloc(LARGE_FILE_BYTES, 1);
    const { file } = await snapshotArchive([...valid, { path: "big.bin", content, storage: "blob" }]);
    const wrong = Buffer.alloc(LARGE_FILE_BYTES, 2);
    await expectRejected(file, "CHECKSUM_MISMATCH", new Map([[sha256(content), wrong]]));
    await expectRejected(file, "CHECKSUM_MISMATCH", new Map([[sha256(content), content.subarray(1)]]));
  });

  test("a total over maxBytes → TOO_LARGE", async () => {
    const { file } = await snapshotArchive([{ path: "a.txt", content: "x".repeat(2000) }]);
    await expectRejected(file, "TOO_LARGE", undefined, { maxBytes: 1000 });
  });

  test("manifest.json not first → INVALID_ARCHIVE", async () => {
    const file = archivePath();
    await buildArchive(file, [fileEntry("files/package.json", "{}"), manifestJsonEntry(manifestOf(valid))]);
    await expectRejected(file, "INVALID_ARCHIVE");
  });

  test("an invalid manifest or a corrupt gzip → INVALID_ARCHIVE", async () => {
    const badJson = archivePath();
    await buildArchive(badJson, [fileEntry("manifest.json", "{not json")]);
    await expectRejected(badJson, "INVALID_ARCHIVE");

    const badShape = archivePath();
    await buildArchive(badShape, [manifestJsonEntry({ version: 2, files: [] })]);
    await expectRejected(badShape, "INVALID_ARCHIVE");

    const badMode = archivePath();
    await buildArchive(badMode, [manifestJsonEntry({ version: 1, files: [{ ...manifestEntry(valid[0]!), mode: 0o777 }] })]);
    await expectRejected(badMode, "INVALID_ARCHIVE");

    const corrupt = archivePath();
    fs.writeFileSync(corrupt, Buffer.from("this is not gzip"));
    await expectRejected(corrupt, "INVALID_ARCHIVE");
  });

  test("an existing destDir → DEST_EXISTS, and it is left untouched", async () => {
    const { file } = await snapshotArchive(valid);
    const destDir = makeTmp();
    fs.writeFileSync(path.join(destDir, "mine.txt"), "keep");
    const result = await extractSnapshot({ archiveFile: file, blobFile: () => undefined, destDir });
    expect(result._unsafeUnwrapErr().code).toBe("DEST_EXISTS");
    expect(fs.readdirSync(destDir)).toEqual(["mine.txt"]);
    expect(leftovers(destDir).filter((n) => n.includes(".partial-"))).toEqual([]);
  });

  test("a pax header carrying more than a path → UNSUPPORTED_ENTRY", async () => {
    const file = archivePath();
    await buildArchive(file, [
      manifestJsonEntry(manifestOf(valid)),
      { header: { name: "files/package.json", type: "file", mode: 0o644, pax: { path: "files/package.json", linkpath: "x" } }, content: "{}" },
    ]);
    await expectRejected(file, "UNSUPPORTED_ENTRY");
  });

  test("a pax global header → UNSUPPORTED_ENTRY", async () => {
    const file = archivePath();
    const global = rawTarRecord("pax_global_header", Buffer.from("20 comment=hostile!\n"), "g");
    const rest = await packTar([
      manifestJsonEntry(manifestOf(valid)),
      fileEntry("files/package.json", "{}"),
      fileEntry("files/src/app.ts", "export {}"),
    ]);
    writeGzip(file, global, rest);
    const { error } = await expectRejected(file, "UNSUPPORTED_ENTRY");
    expect(error.message).toMatch(/global/);
  });

  test("gzip padding far beyond what the entries declare → TOO_LARGE", async () => {
    const file = archivePath();
    await buildArchive(file, [manifestJsonEntry(manifestOf([]))], Buffer.alloc(4 * 1024 * 1024));
    const { error } = await expectRejected(file, "TOO_LARGE");
    expect(error.message).toMatch(/more data than it declares/);
  });
});

describe("extractSnapshot refuses paths scan would exclude", () => {
  test.each([
    ".claude/settings.json",
    ".git/config",
    "node_modules/x/index.js",
    ".env",
    "sub/.npmrc",
    "dist/x",
    // APFS case-folds these onto node_modules, .ssh and .dev.vars (ſ → s)
    "node_module\u017f/react/index.js",
    ".\u017fsh/authorized_keys",
    "sub/.dev.var\u017f",
  ])(
    "%s → UNSAFE_ENTRY (with correct hashes)",
    async (p) => {
      const { file } = await snapshotArchive([...valid, { path: p, content: "payload" }]);
      await expectRejected(file, "UNSAFE_ENTRY");
    },
  );

  test("paths that differ only by APFS case folding (s.txt, ſ.txt) → CASE_COLLISION", async () => {
    const { file } = await snapshotArchive([...valid, { path: "s.txt", content: "a" }, { path: "\u017f.txt", content: "b" }]);
    await expectRejected(file, "CASE_COLLISION");
  });

  test("an excluded tar entry not in the manifest → UNSAFE_ENTRY", async () => {
    const file = archivePath();
    await buildArchive(file, [manifestJsonEntry(manifestOf(valid)), fileEntry("files/.claude/settings.json", "{}")]);
    await expectRejected(file, "UNSAFE_ENTRY");
  });

  test("an excluded blob path → UNSAFE_ENTRY before any blob is read", async () => {
    const { file, blobs } = await snapshotArchive([
      ...valid,
      { path: "node_modules/big.bin", content: Buffer.alloc(LARGE_FILE_BYTES), storage: "blob" },
    ]);
    const { blobFile } = await expectRejected(file, "UNSAFE_ENTRY", blobs);
    expect(blobFile).not.toHaveBeenCalled();
  });
});

describe("extractSnapshot size guards", () => {
  test("a manifest.json header over MAX_MANIFEST_BYTES → TOO_LARGE before its body is read", async () => {
    const file = archivePath();
    // A header that claims 33 MiB, followed by a truncated body
    const tarBytes = Buffer.concat([rawTarHeader("manifest.json", MAX_MANIFEST_BYTES + 1), Buffer.alloc(4096, 0x7b)]);
    fs.writeFileSync(file, zlib.gzipSync(tarBytes));
    const { error } = await expectRejected(file, "TOO_LARGE");
    expect(error.message).toMatch(/manifest/);
    expect((await readSnapshotManifest(file))._unsafeUnwrapErr().code).toBe("TOO_LARGE");
  });

  test("a manifest whose Σ size exceeds maxBytes → TOO_LARGE before blobFile is called", async () => {
    const { file, blobs } = await snapshotArchive([
      ...valid,
      { path: "big.bin", content: Buffer.alloc(LARGE_FILE_BYTES), storage: "blob" },
    ]);
    const { blobFile } = await expectRejected(file, "TOO_LARGE", blobs, { maxBytes: LARGE_FILE_BYTES });
    expect(blobFile).not.toHaveBeenCalled();
  });

  test("maxBytes bounds the files only: a packed snapshot extracts with maxBytes = its uncompressedBytes", async () => {
    // publish checks Σ manifest sizes against MAX_UNCOMPRESSED_BYTES, so extract must accept that
    // total even though manifest.json itself adds bytes to the archive
    const tree: Record<string, string> = {};
    for (let i = 0; i < 50; i++) tree[`f${String(i).padStart(2, "0")}.txt`] = String(i % 10).repeat(1000);
    const source = makeTmp();
    writeTree(source, tree);
    const staging = makeTmp();
    const plan = (await scanWorkspace(source))._unsafeUnwrap();
    const staged = (await stageSnapshot(plan, path.join(staging, "source")))._unsafeUnwrap();
    const packed = (
      await packSnapshot(staged, { archiveFile: path.join(staging, "s.tar.gz"), blobDir: path.join(staging, "blobs") })
    )._unsafeUnwrap();
    expect(packed.uncompressedBytes).toBe(50_000);

    const { result } = await extractFrom(packed.archiveFile, undefined, { maxBytes: packed.uncompressedBytes });
    expect(result._unsafeUnwrap().bytes).toBe(50_000);
    await expectRejected(packed.archiveFile, "TOO_LARGE", undefined, { maxBytes: packed.uncompressedBytes - 1 });
  });

  test("archive files adding up to exactly maxBytes extract; the manifest is not counted", async () => {
    const { file } = await snapshotArchive([
      { path: "a.txt", content: "a".repeat(600) },
      { path: "b.txt", content: "b".repeat(400) },
    ]);
    const { result } = await extractFrom(file, undefined, { maxBytes: 1000 });
    expect(result._unsafeUnwrap().bytes).toBe(1000);
  });

  test("a manifest with more files than maxFiles → TOO_LARGE before blobFile is called", async () => {
    const { file, blobs } = await snapshotArchive([
      ...valid,
      { path: "big.bin", content: Buffer.alloc(LARGE_FILE_BYTES), storage: "blob" },
    ]);
    const { blobFile } = await expectRejected(file, "TOO_LARGE", blobs, { maxFiles: 2 });
    expect(blobFile).not.toHaveBeenCalled();
  });

  test("a manifest that declares a huge blob it does not ship is refused on size, not read", async () => {
    const manifest = manifestOf(valid);
    manifest.files.push({ path: "huge.bin", size: 10 * 1024 ** 4, sha256: "0".repeat(64), mode: 0o644, storage: "blob" });
    const file = archivePath();
    await buildArchive(file, [manifestJsonEntry(manifest), fileEntry("files/package.json", "{}"), fileEntry("files/src/app.ts", "export {}")]);
    const { blobFile } = await expectRejected(file, "TOO_LARGE");
    expect(blobFile).not.toHaveBeenCalled();
  });
});

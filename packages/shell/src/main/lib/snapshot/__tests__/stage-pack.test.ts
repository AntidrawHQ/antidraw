import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { largestFiles, packSnapshot } from "../pack";
import { scanWorkspace } from "../scan";
import { stageSnapshot } from "../stage";
import { LARGE_FILE_BYTES, MAX_MANIFEST_BYTES, type PackedSnapshot, type SnapshotPlan, type StagedSnapshot } from "../types";
import { cleanupTmp, listArchive, makeTmp, readTree, sha256, writeTree, type TreeNode } from "./helpers";

afterEach(cleanupTmp);

const scan = async (dir: string): Promise<SnapshotPlan> => (await scanWorkspace(dir))._unsafeUnwrap();

const stage = async (plan: SnapshotPlan, staging = makeTmp()): Promise<StagedSnapshot> =>
  (await stageSnapshot(plan, path.join(staging, "source")))._unsafeUnwrap();

const pack = async (staged: StagedSnapshot, out = makeTmp()): Promise<PackedSnapshot> =>
  (
    await packSnapshot(staged, { archiveFile: path.join(out, "snapshot.tar.gz"), blobDir: path.join(out, "blobs") })
  )._unsafeUnwrap();

const workspace = (tree: Record<string, TreeNode>) => {
  const dir = makeTmp();
  writeTree(dir, tree);
  return dir;
};

const big = (fill: number, size = LARGE_FILE_BYTES) => Buffer.alloc(size, fill);

// A signal that reads as aborted from its `after`+1-th check on: a cancel that lands partway
const abortsAfter = (after: number) => {
  let checks = 0;
  return {
    get aborted() {
      checks += 1;
      return checks > after;
    },
    get checks() {
      return checks;
    },
  } as unknown as AbortSignal & { checks: number };
};

describe("stageSnapshot", () => {
  test("copies exactly the scanned files, with their bytes and modes", async () => {
    const dir = workspace({
      ".gitignore": "*.log\n",
      "src/app.ts": "export const a = 1;\n",
      "run.sh": { content: "#!/bin/sh\necho hi\n", mode: 0o755 },
      "debug.log": "not staged",
      ".env": "SECRET=1",
      "link.txt": { symlink: "src/app.ts" },
    });
    const staged = await stage(await scan(dir));

    const tree = readTree(staged.dir);
    expect(Object.keys(tree).sort()).toEqual([".gitignore", "link.txt", "run.sh", "src/app.ts"]);
    expect(tree["src/app.ts"]?.content).toEqual(fs.readFileSync(path.join(dir, "src/app.ts")));
    expect(tree["link.txt"]?.content.toString()).toBe("export const a = 1;\n");
    expect(fs.lstatSync(path.join(staged.dir, "link.txt")).isFile()).toBe(true);
    expect(tree["run.sh"]?.mode).toBe(0o755);
    expect(tree["src/app.ts"]?.mode).toBe(0o644);
    expect(fs.statSync(staged.dir).mode & 0o777).toBe(0o700);

    expect(staged.manifest.files.find((f) => f.path === "src/app.ts")).toEqual({
      path: "src/app.ts",
      size: 20,
      sha256: sha256("export const a = 1;\n"),
      mode: 0o644,
      storage: "archive",
    });
  });

  test("the copied bytes define size and sha256", async () => {
    const dir = workspace({ "a.txt": "short" });
    const plan = await scan(dir);
    fs.appendFileSync(path.join(dir, "a.txt"), " and longer");
    const staged = await stage(plan);
    expect(staged.manifest.files[0]).toMatchObject({ size: 16, sha256: sha256("short and longer") });
  });

  test("the 1 MiB boundary: exactly 1 MiB is a blob, 1 MiB - 1 is archived", async () => {
    const dir = workspace({ "at.bin": big(1), "under.bin": big(2, LARGE_FILE_BYTES - 1) });
    const staged = await stage(await scan(dir));
    expect(staged.manifest.files.map((f) => [f.path, f.storage])).toEqual([
      ["at.bin", "blob"],
      ["under.bin", "archive"],
    ]);
  });

  test("a file replaced by a symlink to an outside file after the scan → STAGE_FAILED, nothing copied", async () => {
    const outside = makeTmp();
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside secret");
    const dir = workspace({ "a.txt": "a", "b.txt": "b" });
    const plan = await scan(dir);
    fs.rmSync(path.join(dir, "b.txt"));
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "b.txt"));

    const dest = path.join(makeTmp(), "source");
    const result = await stageSnapshot(plan, dest);
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "STAGE_FAILED", paths: ["b.txt"] });
    expect(fs.existsSync(dest)).toBe(false);
  });

  test("a parent directory replaced by a symlink after the scan → STAGE_FAILED (inode mismatch)", async () => {
    const outside = makeTmp();
    writeTree(outside, { "a.txt": "outside" });
    const dir = workspace({ "sub/a.txt": "inside" });
    const plan = await scan(dir);
    fs.renameSync(path.join(dir, "sub"), path.join(dir, "sub-old"));
    fs.symlinkSync(outside, path.join(dir, "sub"));

    const dest = path.join(makeTmp(), "source");
    const result = await stageSnapshot(plan, dest);
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "STAGE_FAILED", paths: ["sub/a.txt"] });
    expect(fs.existsSync(dest)).toBe(false);
  });

  test("a symlink retargeted to an excluded file after the scan → STAGE_FAILED", async () => {
    const dir = workspace({ "real.txt": "real", ".env": "SECRET=1", "link.txt": { symlink: "real.txt" } });
    const plan = await scan(dir);
    fs.rmSync(path.join(dir, "link.txt"));
    fs.symlinkSync(".env", path.join(dir, "link.txt"));
    const result = await stageSnapshot(plan, path.join(makeTmp(), "source"));
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "STAGE_FAILED", paths: ["link.txt"] });
  });

  test("the destination must not exist", async () => {
    const plan = await scan(workspace({ "a.txt": "a" }));
    const dest = makeTmp();
    expect((await stageSnapshot(plan, dest))._unsafeUnwrapErr().code).toBe("STAGE_FAILED");
    expect(fs.existsSync(dest)).toBe(true);
  });

  test("an aborted signal → CANCELLED and the staging dir is removed", async () => {
    const plan = await scan(workspace({ "a.txt": "a" }));
    const controller = new AbortController();
    controller.abort();
    const dest = path.join(makeTmp(), "source");
    expect((await stageSnapshot(plan, dest, { signal: controller.signal }))._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe("stageSnapshot: cancel and byte budget", () => {
  test("a cancel partway through a large file stops that copy → CANCELLED, staging dir removed", async () => {
    const plan = await scan(workspace({ "movie.bin": big(3, 3 * LARGE_FILE_BYTES) }));
    const dest = path.join(makeTmp(), "source");
    // 1: before the file; 2: before its first chunk; 3: before its second chunk
    const signal = abortsAfter(2);
    const result = await stageSnapshot(plan, dest, { signal });
    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(signal.checks).toBe(3);
    expect(fs.existsSync(dest)).toBe(false);
  });

  test("files adding up to more than maxBytes → TOO_LARGE without copying the rest", async () => {
    const plan = await scan(workspace({ "a.bin": big(1, 600_000), "b.bin": big(2, 600_000), "c.bin": big(3, 600_000) }));
    const dest = path.join(makeTmp(), "source");
    const result = await stageSnapshot(plan, dest, { maxBytes: 1_000_000 });
    expect(result._unsafeUnwrapErr().code).toBe("TOO_LARGE");
    expect(fs.existsSync(dest)).toBe(false);
  });

  test("a file that grew past the budget after the scan → TOO_LARGE", async () => {
    const dir = workspace({ "a.txt": "small" });
    const plan = await scan(dir);
    fs.appendFileSync(path.join(dir, "a.txt"), big(4, 2 * LARGE_FILE_BYTES));
    const result = await stageSnapshot(plan, path.join(makeTmp(), "source"), { maxBytes: LARGE_FILE_BYTES });
    expect(result._unsafeUnwrapErr().code).toBe("TOO_LARGE");
  });

  test("exactly maxBytes is staged", async () => {
    const plan = await scan(workspace({ "a.bin": big(1, 1000), "b.bin": big(2, 24) }));
    const result = await stageSnapshot(plan, path.join(makeTmp(), "source"), { maxBytes: 1024 });
    expect(result.isOk()).toBe(true);
  });
});

describe("packSnapshot: cancel", () => {
  const outs = () => {
    const out = makeTmp();
    return { archiveFile: path.join(out, "snapshot.tar.gz"), blobDir: path.join(out, "blobs") };
  };

  test("an aborted signal → CANCELLED, nothing left behind", async () => {
    const staged = await stage(await scan(workspace({ "a.txt": "a" })));
    const controller = new AbortController();
    controller.abort();
    const out = outs();
    const result = await packSnapshot(staged, out, { signal: controller.signal });
    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(fs.existsSync(out.archiveFile)).toBe(false);
    expect(fs.existsSync(out.blobDir)).toBe(false);
  });

  test("a cancel between archive entries → CANCELLED, outputs removed", async () => {
    const staged = await stage(await scan(workspace({ "a.txt": "a", "b.txt": "b", "c.txt": "c" })));
    const out = outs();
    // 1: before the archive; 2: before a.txt; 3: before b.txt
    const signal = abortsAfter(2);
    const result = await packSnapshot(staged, out, { signal });
    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(signal.checks).toBe(3);
    expect(fs.existsSync(out.archiveFile)).toBe(false);
    expect(fs.existsSync(out.blobDir)).toBe(false);
  });

  test("a cancel between blob copies → CANCELLED, outputs removed", async () => {
    const staged = await stage(await scan(workspace({ "one.bin": big(1), "two.bin": big(2) })));
    const out = outs();
    // 1: before the archive (no archive files); 2: before the first blob; 3: before the second
    const signal = abortsAfter(2);
    const result = await packSnapshot(staged, out, { signal });
    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(signal.checks).toBe(3);
    expect(fs.existsSync(out.archiveFile)).toBe(false);
    expect(fs.existsSync(out.blobDir)).toBe(false);
  });
});

describe("packSnapshot", () => {
  const sample = () =>
    workspace({
      ".gitignore": "*.log\n",
      "src/b.ts": "export const b = 2;\n",
      "src/a.ts": "export const a = 1;\n",
      "run.sh": { content: "#!/bin/sh\n", mode: 0o755 },
      "assets/one.bin": big(7),
      "assets/copy.bin": big(7),
      "assets/two.bin": big(9, LARGE_FILE_BYTES + 10),
    });

  test("counts, blobs, sizes and the snapshotBytes math", async () => {
    const staged = await stage(await scan(sample()));
    const packed = await pack(staged);

    expect(packed.fileCount).toBe(7);
    expect(packed.uncompressedBytes).toBe(staged.manifest.files.reduce((s, f) => s + f.size, 0));
    expect(packed.archiveSize).toBe(fs.statSync(packed.archiveFile).size);
    expect(packed.archiveSha256).toBe(sha256(fs.readFileSync(packed.archiveFile)));
    expect(packed.snapshotBytes).toBe(packed.archiveSize + LARGE_FILE_BYTES + LARGE_FILE_BYTES + 10);

    // Deduplicated by sha, with every path listed
    expect(packed.blobs.map((b) => [b.sha256, b.size, b.paths])).toEqual(
      [
        [sha256(big(7)), LARGE_FILE_BYTES, ["assets/copy.bin", "assets/one.bin"]],
        [sha256(big(9, LARGE_FILE_BYTES + 10)), LARGE_FILE_BYTES + 10, ["assets/two.bin"]],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    for (const blob of packed.blobs) {
      expect(path.dirname(blob.file)).toBe(path.join(path.dirname(packed.archiveFile), "blobs"));
      expect(path.basename(blob.file)).toBe(blob.sha256);
      expect(sha256(fs.readFileSync(blob.file))).toBe(blob.sha256);
    }
    expect(fs.statSync(path.dirname(packed.blobs[0]!.file)).mode & 0o777).toBe(0o700);

    // Manifest sha256 values match the files
    for (const f of packed.manifest.files) {
      expect(f.sha256, f.path).toBe(sha256(fs.readFileSync(path.join(staged.dir, f.path))));
    }
    expect(largestFiles(packed.manifest, 2)).toEqual([
      { path: "assets/two.bin", size: LARGE_FILE_BYTES + 10 },
      { path: "assets/copy.bin", size: LARGE_FILE_BYTES },
    ]);
  });

  test("blob copies are private: overwriting the staged file afterwards does not change them", async () => {
    const staged = await stage(await scan(sample()));
    const packed = await pack(staged);
    const blob = packed.blobs.find((b) => b.paths.includes("assets/one.bin"))!;
    fs.writeFileSync(path.join(staged.dir, "assets/one.bin"), big(1));
    expect(sha256(fs.readFileSync(blob.file))).toBe(blob.sha256);
  });

  test("the tar layout: manifest.json first, files/ sorted, no directories, fixed header fields", async () => {
    const staged = await stage(await scan(sample()));
    const packed = await pack(staged);
    const entries = await listArchive(packed.archiveFile);

    expect(entries.map((e) => e.header.name)).toEqual([
      "manifest.json",
      "files/.gitignore",
      "files/run.sh",
      "files/src/a.ts",
      "files/src/b.ts",
    ]);
    for (const { header } of entries) {
      expect(header.type).toBe("file");
      expect(header.mtime?.getTime()).toBe(0);
      expect(header.uid).toBe(0);
      expect(header.gid).toBe(0);
      expect([420, 493]).toContain(header.mode);
    }
    expect(entries.find((e) => e.header.name === "files/run.sh")?.header.mode).toBe(493);

    const manifest = JSON.parse(entries[0]!.content.toString());
    expect(manifest).toEqual(packed.manifest);
    expect(entries[0]!.content.toString()).toBe(JSON.stringify(packed.manifest));
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain("assets/one.bin");
  });

  test("gzip byte 9 (OS) is 0xff and MTIME is 0", async () => {
    const packed = await pack(await stage(await scan(sample())));
    const bytes = fs.readFileSync(packed.archiveFile);
    expect(bytes[9]).toBe(0xff);
    expect(bytes.readUInt32LE(4)).toBe(0);
    expect(zlib.gunzipSync(bytes).length).toBeGreaterThan(0);
  });

  test("deterministic: same content → same bytes → same hash, whatever the mtimes and read bits", async () => {
    const dir = sample();
    const first = await pack(await stage(await scan(dir)));

    const later = new Date(Date.now() + 3_600_000);
    for (const f of ["src/a.ts", "src/b.ts", ".gitignore", "assets/one.bin"]) {
      fs.utimesSync(path.join(dir, f), later, later);
      fs.chmodSync(path.join(dir, f), 0o600);
    }
    fs.chmodSync(path.join(dir, "run.sh"), 0o700);
    const second = await pack(await stage(await scan(dir)));

    expect(second.archiveSha256).toBe(first.archiveSha256);
    expect(fs.readFileSync(second.archiveFile).equals(fs.readFileSync(first.archiveFile))).toBe(true);
    expect(second.blobs.map((b) => b.sha256)).toEqual(first.blobs.map((b) => b.sha256));
  });

  test("long and non-ASCII paths pack deterministically", async () => {
    const long = `${"deep/".repeat(30)}file.ts`;
    const dir = workspace({ [long]: "x", "ünïcode/файл.txt": "y" });
    const a = await pack(await stage(await scan(dir)));
    const b = await pack(await stage(await scan(dir)));
    expect(a.archiveSha256).toBe(b.archiveSha256);
    const names = (await listArchive(a.archiveFile)).map((e) => e.header.name);
    expect(names).toEqual(["manifest.json", `files/${long}`, "files/ünïcode/файл.txt"]);
  });

  test("a staged file changed before pack → PACK_FAILED and outputs removed", async () => {
    const staged = await stage(await scan(workspace({ "a.txt": "a" })));
    fs.writeFileSync(path.join(staged.dir, "a.txt"), "changed");
    const out = makeTmp();
    const archiveFile = path.join(out, "snapshot.tar.gz");
    const blobDir = path.join(out, "blobs");
    const result = await packSnapshot(staged, { archiveFile, blobDir });
    expect(result._unsafeUnwrapErr().code).toBe("PACK_FAILED");
    expect(fs.existsSync(archiveFile)).toBe(false);
    expect(fs.existsSync(blobDir)).toBe(false);
  });

  test("a manifest.json over MAX_MANIFEST_BYTES → TOO_LARGE before anything is written", async () => {
    // 100 000 files (the file cap) with ~250-byte paths: well under the byte caps, but a
    // manifest extract would refuse. Refused on the manifest alone, so no staged files are needed
    const dir = "d".repeat(240);
    const files = Array.from({ length: 100_000 }, (_, i) => ({
      path: `${dir}/${i}.txt`,
      size: 1,
      sha256: "0".repeat(64),
      mode: 0o644 as const,
      storage: "archive" as const,
    }));
    expect(Buffer.byteLength(JSON.stringify({ version: 1, files }))).toBeGreaterThan(MAX_MANIFEST_BYTES);
    const staged: StagedSnapshot = {
      dir: makeTmp(),
      manifest: { version: 1, files },
      excluded: { listed: [], grouped: [] },
    };
    const out = makeTmp();
    const archiveFile = path.join(out, "snapshot.tar.gz");
    const blobDir = path.join(out, "blobs");
    const result = await packSnapshot(staged, { archiveFile, blobDir });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("TOO_LARGE");
    expect(error.message).toMatch(/manifest\.json/);
    expect(fs.existsSync(archiveFile)).toBe(false);
    expect(fs.existsSync(blobDir)).toBe(false);
  });

  test("blobDir must not exist", async () => {
    const staged = await stage(await scan(workspace({ "a.txt": "a" })));
    const out = makeTmp();
    fs.mkdirSync(path.join(out, "blobs"));
    const result = await packSnapshot(staged, { archiveFile: path.join(out, "s.tar.gz"), blobDir: path.join(out, "blobs") });
    expect(result._unsafeUnwrapErr().code).toBe("PACK_FAILED");
  });
});

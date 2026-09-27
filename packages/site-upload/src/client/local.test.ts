import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readable, sha256, thrown, thrownSync } from "../../test/helpers";
import { DEFAULT_LIMITS } from "../protocol/limits";
import { buildManifest, checkLocalFiles, hashFile, listFiles, mapLimit, type LocalFile } from "./local";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "site-upload-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function write(files: Record<string, string | Uint8Array>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

/** Listed files without the machine-specific absolute path. */
const relative = (files: LocalFile[]) => files.map(({ path, size }) => ({ path, size }));

describe("listFiles", () => {
  it("lists nested files with forward-slash NFC paths, sorted", async () => {
    await write({ "index.html": "a", "assets/x/y.js": "bb", ".well-known/z": "", "café.txt": "x" });
    const files = relative(await listFiles(dir));
    expect(files.map((f) => f.path.normalize("NFC") === f.path)).not.toContain(false);
    expect(files).toMatchInlineSnapshot(`
      [
        {
          "path": ".well-known/z",
          "size": 0,
        },
        {
          "path": "assets/x/y.js",
          "size": 2,
        },
        {
          "path": "café.txt",
          "size": 1,
        },
        {
          "path": "index.html",
          "size": 1,
        },
      ]
    `);
  });

  it("refuses symlinks and things that aren't folders", async () => {
    await write({ "real.txt": "x" });
    await mkdir(join(dir, "realdir"));
    const fileLink = await (async () => {
      await symlink(join(dir, "real.txt"), join(dir, "link.txt"));
      const err = await thrown(listFiles(dir));
      await rm(join(dir, "link.txt"));
      return err;
    })();
    await symlink(join(dir, "realdir"), join(dir, "linkdir"));
    const dirLink = await thrown(listFiles(dir));
    const notAFolder = await thrown(listFiles(join(dir, "real.txt")));
    expect({ fileLink, dirLink, notAFolder: { ...notAFolder, message: notAFolder.message.replace(dir, "<dir>") } })
      .toMatchInlineSnapshot(`
        {
          "dirLink": {
            "code": "UNSUPPORTED_FILE",
            "details": {
              "path": "linkdir",
            },
            "error": "SiteUploadError",
            "message": "linkdir is a symlink",
          },
          "fileLink": {
            "code": "UNSUPPORTED_FILE",
            "details": {
              "path": "link.txt",
            },
            "error": "SiteUploadError",
            "message": "link.txt is a symlink",
          },
          "notAFolder": {
            "code": "UNSUPPORTED_FILE",
            "error": "SiteUploadError",
            "message": "<dir>/real.txt is not a folder",
          },
        }
      `);
  });
});

describe("listFiles limits", () => {
  it("stops walking as soon as the folder passes the file limit", async () => {
    await write(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`d${i % 4}/f${i}.txt`, "x"])));
    let hashed = 0;
    const err = await thrown(buildManifest(dir, { limits: { maxFiles: 5 }, onHashed: () => hashed++ }));
    expect({ err, hashed }).toMatchInlineSnapshot(`
      {
        "err": {
          "code": "TOO_LARGE",
          "details": {
            "limit": 5,
            "reason": "files",
          },
          "error": "SiteUploadError",
          "message": "The folder has more than 5 files",
        },
        "hashed": 0,
      }
    `);
  });

  it("stops walking when aborted", async () => {
    await write({ "a/b.txt": "x" });
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    expect(await thrown(listFiles(dir, { signal: controller.signal }))).toMatchInlineSnapshot(`
      {
        "error": "Error",
        "message": "stop",
      }
    `);
  });
});

describe("checkLocalFiles", () => {
  const file = (path: string, size = 1): LocalFile => ({ path, absPath: `/x/${path}`, size });

  it("refuses what a site can't hold, before any hashing", () => {
    expect({
      empty: thrownSync(() => checkLocalFiles([], DEFAULT_LIMITS)),
      "same name after NFC": thrownSync(() => checkLocalFiles([file("é.txt"), file("é.txt")], DEFAULT_LIMITS)),
      backslash: thrownSync(() => checkLocalFiles([file("a\\b.txt")], DEFAULT_LIMITS)),
      "too many": thrownSync(() => checkLocalFiles([file("a"), file("b")], { ...DEFAULT_LIMITS, maxFiles: 1 })),
      "one too big": thrownSync(() => checkLocalFiles([file("a", 11)], { ...DEFAULT_LIMITS, maxFileBytes: 10 })),
      "total too big, with the largest files": thrownSync(() =>
        checkLocalFiles(
          ["a", "b", "c", "d", "e", "f"].map((name, i) => file(name, i + 1)),
          { ...DEFAULT_LIMITS, maxTotalBytes: 20 },
        ),
      ),
    }).toMatchInlineSnapshot(`
      {
        "backslash": {
          "code": "INVALID_MANIFEST",
          "details": {
            "path": "a\\b.txt",
          },
          "error": "SiteUploadError",
          "message": "Path "a\\\\b.txt" contains a control character, backslash or invalid UTF-16",
        },
        "empty": {
          "code": "INVALID_MANIFEST",
          "error": "SiteUploadError",
          "message": "The folder has no files",
        },
        "one too big": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 11,
            "limit": 10,
            "path": "a",
            "reason": "file",
          },
          "error": "SiteUploadError",
          "message": "a is 11 bytes, over the 10-byte file limit",
        },
        "same name after NFC": {
          "code": "INVALID_MANIFEST",
          "details": {
            "path": "é.txt",
          },
          "error": "SiteUploadError",
          "message": "Two files have the same name after Unicode normalization: é.txt",
        },
        "too many": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 2,
            "limit": 1,
            "reason": "files",
          },
          "error": "SiteUploadError",
          "message": "2 files is over the 1-file limit",
        },
        "total too big, with the largest files": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 21,
            "largest": [
              {
                "path": "f",
                "size": 6,
              },
              {
                "path": "e",
                "size": 5,
              },
              {
                "path": "d",
                "size": 4,
              },
              {
                "path": "c",
                "size": 3,
              },
              {
                "path": "b",
                "size": 2,
              },
            ],
            "limit": 20,
            "reason": "total",
          },
          "error": "SiteUploadError",
          "message": "The folder is 21 bytes, over the 20-byte limit",
        },
      }
    `);
  });
});

describe("hashFile", () => {
  it("hashes a large file by streaming it", async () => {
    const big = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
    await write({ "big.bin": big });
    expect(await hashFile(join(dir, "big.bin"), big.length)).toBe(sha256(big));
  });

  it("fails if the size differs from the listing", async () => {
    await write({ "a.txt": "abc" });
    const err = await thrown(hashFile(join(dir, "a.txt"), 2));
    expect({ ...err, message: err.message.replace(dir, "<dir>"), details: "<path>" }).toMatchInlineSnapshot(`
      {
        "code": "FILE_CHANGED",
        "details": "<path>",
        "error": "SiteUploadError",
        "message": "<dir>/a.txt changed while it was being read",
      }
    `);
  });
});

describe("buildManifest", () => {
  it("builds a canonical manifest and one upload source per hash", async () => {
    await write({ "index.html": "same", "copy.html": "same", "assets/app-1a.js": "js" });
    // Registers the hashes so the snapshot can name them.
    sha256("same");
    sha256("js");
    const local = await buildManifest(dir, { immutable: (path) => path.startsWith("assets/") });
    expect(
      readable({
        manifest: JSON.parse(JSON.stringify(local.manifest)),
        sources: [...local.sources].map(([hash, file]) => [hash, file.path]),
        totalBytes: local.totalBytes,
      }),
    ).toMatchInlineSnapshot(`
      {
        "manifest": {
          "files": {
            "assets/app-1a.js": {
              "h": "sha(js)",
              "i": true,
              "s": 2,
            },
            "copy.html": {
              "h": "sha(same)",
              "s": 4,
            },
            "index.html": {
              "h": "sha(same)",
              "s": 4,
            },
          },
          "v": 1,
        },
        "sources": [
          [
            "sha(js)",
            "assets/app-1a.js",
          ],
          [
            "sha(same)",
            "copy.html",
          ],
        ],
        "totalBytes": 10,
      }
    `);
  });

  it("fails on limits before hashing anything", async () => {
    await write({ "a.bin": "x" });
    // A sparse 2 GiB file: reading it would take seconds, checking its size doesn't.
    await truncate(join(dir, "a.bin"), 2 * 1024 ** 3);
    let hashed = 0;
    const started = performance.now();
    const err = await thrown(buildManifest(dir, { onHashed: () => hashed++ }));
    expect(performance.now() - started).toBeLessThan(500);
    expect({ err, hashed }).toMatchInlineSnapshot(`
      {
        "err": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 2147483648,
            "limit": 99614720,
            "path": "a.bin",
            "reason": "file",
          },
          "error": "SiteUploadError",
          "message": "a.bin is 2147483648 bytes, over the 99614720-byte file limit",
        },
        "hashed": 0,
      }
    `);
  });

  it("stops when aborted", async () => {
    await write(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}.txt`, "x".repeat(1000)])));
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    expect(await thrown(buildManifest(dir, { signal: controller.signal }))).toMatchInlineSnapshot(`
      {
        "error": "Error",
        "message": "stop",
      }
    `);
  });
});

describe("mapLimit", () => {
  it("keeps order and never runs more than the limit at once", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, n));
      active--;
      return n * 10;
    });
    expect({ result, peak }).toMatchInlineSnapshot(`
      {
        "peak": 2,
        "result": [
          50,
          10,
          40,
          20,
          30,
        ],
      }
    `);
  });
});

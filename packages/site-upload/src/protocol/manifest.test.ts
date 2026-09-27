import { describe, expect, it } from "vitest";
import { manifestOf, readable, sha256, thrownSync } from "../../test/helpers";
import { DEFAULT_LIMITS, type Limits } from "./limits";
import { hashSizes, isHash, isId, parseManifest, pathProblem, sameFiles } from "./manifest";

const H = sha256("x");

// JSON.stringify leaves DEL and combining marks as is, which a snapshot can't show.
const visible = (text: string) =>
  JSON.stringify(text).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

const withPaths = (...paths: string[]) => ({
  v: 1,
  files: Object.fromEntries(paths.map((path) => [path, { h: H, s: 1 }])),
});

const tryParse = (input: unknown, limits?: Limits) => {
  try {
    return readable(parseManifest(input, limits));
  } catch {
    return thrownSync(() => parseManifest(input, limits));
  }
};

describe("pathProblem", () => {
  it("accepts ordinary site paths and rejects the rest", () => {
    const paths = [
      "index.html",
      "assets/app-1a2b.js",
      "é/ü.png",
      "with space.txt",
      ".well-known/x",
      "",
      "/index.html",
      "dir/",
      "a//b",
      "./a",
      "a/../b",
      "..",
      "a\\b",
      "a\u0000b",
      "a\nb",
      "a\u007fb",
      "bad\ud800",
      "é.txt",
    ];
    expect(Object.fromEntries(paths.map((path) => [visible(path), pathProblem(path, 1024)])))
      .toMatchInlineSnapshot(`
        {
          """": "is empty",
          "".."": "has a . or .. segment",
          ""./a"": "has a . or .. segment",
          "".well-known/x"": null,
          ""/index.html"": "has an empty segment",
          ""\\u00e9/\\u00fc.png"": null,
          ""a/../b"": "has a . or .. segment",
          ""a//b"": "has an empty segment",
          ""a\\\\b"": "contains a control character, backslash or invalid UTF-16",
          ""a\\nb"": "contains a control character, backslash or invalid UTF-16",
          ""a\\u0000b"": "contains a control character, backslash or invalid UTF-16",
          ""a\\u007fb"": "contains a control character, backslash or invalid UTF-16",
          ""assets/app-1a2b.js"": null,
          ""bad\\ud800"": "contains a control character, backslash or invalid UTF-16",
          ""dir/"": "has an empty segment",
          ""e\\u0301.txt"": "is not NFC-normalized",
          ""index.html"": null,
          ""with space.txt"": null,
        }
      `);
  });

  it("measures length in UTF-8 bytes, not characters", () => {
    expect([pathProblem("é".repeat(512), 1024), pathProblem("é".repeat(513), 1024)]).toMatchInlineSnapshot(`
      [
        null,
        "is longer than 1024 bytes",
      ]
    `);
  });
});

describe("isHash / isId", () => {
  it("accepts only lowercase 64-char hex hashes", () => {
    const cases = { lower: H, upper: H.toUpperCase(), short: H.slice(1), long: `${H}0`, number: 42 };
    expect(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, isHash(v)]))).toMatchInlineSnapshot(`
      {
        "long": false,
        "lower": true,
        "number": false,
        "short": false,
        "upper": false,
      }
    `);
  });

  it("accepts ids that are safe as one key segment", () => {
    const ids = ["site-1_A", "a".repeat(128), "a".repeat(129), "", "-lead", "_lead", "a/b", "a.b", "a b", "..", "é"];
    expect(Object.fromEntries(ids.map((id) => [id.length > 20 ? `${id.length} chars` : id, isId(id)])))
      .toMatchInlineSnapshot(`
        {
          "": false,
          "-lead": false,
          "..": false,
          "128 chars": true,
          "129 chars": false,
          "_lead": false,
          "a b": false,
          "a.b": false,
          "a/b": false,
          "site-1_A": true,
          "é": false,
        }
      `);
  });
});

describe("parseManifest", () => {
  it("returns a canonical, sorted copy with only known fields", () => {
    const parsed = parseManifest({
      v: 1,
      files: {
        "z.txt": { h: H, s: 1, extra: "dropped" },
        "a.txt": { h: H, s: 1, i: true },
      },
    });
    expect(Object.getPrototypeOf(parsed.files)).toBeNull();
    expect(JSON.stringify(readable(parsed))).toMatchInlineSnapshot(`"{"v":1,"files":{"a.txt":{"h":"sha(x)","s":1,"i":true},"z.txt":{"h":"sha(x)","s":1}}}"`);
  });

  it("gives the same JSON for the same files in any order", () => {
    const a = parseManifest(withPaths("b", "a", "c/d"));
    const b = parseManifest(withPaths("c/d", "a", "b"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(sameFiles(a.files, b.files)).toBe(true);
  });

  it("treats __proto__ and constructor as ordinary paths", () => {
    const input = JSON.parse(`{"v":1,"files":{"__proto__":{"h":"${H}","s":1},"constructor":{"h":"${H}","s":1}}}`);
    const parsed = parseManifest(input);
    expect(JSON.stringify(readable(parsed))).toMatchInlineSnapshot(`"{"v":1,"files":{"__proto__":{"h":"sha(x)","s":1},"constructor":{"h":"sha(x)","s":1}}}"`);
    expect(({} as Record<string, unknown>).h).toBeUndefined();
  });

  it("rejects malformed manifests", () => {
    const cases: Record<string, unknown> = {
      null: null,
      array: [],
      string: "x",
      "wrong version": { v: 2, files: {} },
      "files as array": { v: 1, files: [] },
      "no files": { v: 1, files: {} },
      "entry not an object": { v: 1, files: { a: "x" } },
      "uppercase hash": { v: 1, files: { a: { h: H.toUpperCase(), s: 1 } } },
      "missing size": { v: 1, files: { a: { h: H } } },
      "negative size": { v: 1, files: { a: { h: H, s: -1 } } },
      "fractional size": { v: 1, files: { a: { h: H, s: 1.5 } } },
      "NaN size": { v: 1, files: { a: { h: H, s: Number.NaN } } },
      "string size": { v: 1, files: { a: { h: H, s: "1" } } },
      "i not true": { v: 1, files: { a: { h: H, s: 1, i: false } } },
      "bad path": withPaths("../escape"),
      "file and folder": withPaths("a", "a-b", "a.c", "a/b"),
      "deep file and folder": withPaths("x/y/z", "x/y/z/w/v"),
      "one hash, two sizes": { v: 1, files: { a: { h: H, s: 1 }, b: { h: H, s: 2 } } },
    };
    expect(Object.fromEntries(Object.entries(cases).map(([name, input]) => [name, tryParse(input)])))
      .toMatchInlineSnapshot(`
        {
          "NaN size": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: s must be a non-negative integer",
          },
          "array": {
            "code": "INVALID_MANIFEST",
            "error": "SiteUploadError",
            "message": "Manifest must be an object with v: 1",
          },
          "bad path": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "../escape",
            },
            "error": "SiteUploadError",
            "message": "Path "../escape" has a . or .. segment",
          },
          "deep file and folder": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "x/y/z",
            },
            "error": "SiteUploadError",
            "message": "x/y/z is both a file and a folder",
          },
          "entry not an object": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: h must be a lowercase sha256 hex digest",
          },
          "file and folder": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a is both a file and a folder",
          },
          "files as array": {
            "code": "INVALID_MANIFEST",
            "error": "SiteUploadError",
            "message": "Manifest files must be an object",
          },
          "fractional size": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: s must be a non-negative integer",
          },
          "i not true": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: i must be true when present",
          },
          "missing size": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: s must be a non-negative integer",
          },
          "negative size": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: s must be a non-negative integer",
          },
          "no files": {
            "code": "INVALID_MANIFEST",
            "error": "SiteUploadError",
            "message": "Manifest has no files",
          },
          "null": {
            "code": "INVALID_MANIFEST",
            "error": "SiteUploadError",
            "message": "Manifest must be an object with v: 1",
          },
          "one hash, two sizes": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "b",
            },
            "error": "SiteUploadError",
            "message": "b: the same hash appears with two different sizes",
          },
          "string": {
            "code": "INVALID_MANIFEST",
            "error": "SiteUploadError",
            "message": "Manifest must be an object with v: 1",
          },
          "string size": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: s must be a non-negative integer",
          },
          "uppercase hash": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "a",
            },
            "error": "SiteUploadError",
            "message": "a: h must be a lowercase sha256 hex digest",
          },
          "wrong version": {
            "code": "INVALID_MANIFEST",
            "error": "SiteUploadError",
            "message": "Manifest must be an object with v: 1",
          },
        }
      `);
  });

  it("accepts neighbours of a file that aren't inside it", () => {
    expect(Object.keys(parseManifest(withPaths("a", "a-b", "ab/c", "a.d/e")).files)).toMatchInlineSnapshot(`
      [
        "a",
        "a-b",
        "a.d/e",
        "ab/c",
      ]
    `);
  });

  it("enforces each limit, and allows exactly the limit", () => {
    const limits: Limits = {
      maxFiles: 3,
      maxFileBytes: 10,
      maxTotalBytes: 15,
      maxPathBytes: 8,
      maxManifestBytes: 1000,
    };
    const cases: Record<string, unknown> = {
      "4 files": withPaths("a", "b", "c", "d"),
      "11-byte file": { v: 1, files: { a: { h: H, s: 11 } } },
      "16 bytes total": { v: 1, files: { a: { h: sha256("1"), s: 8 }, b: { h: sha256("2"), s: 8 } } },
      "9-byte path": withPaths("123456789"),
      "exactly the limits": {
        v: 1,
        files: { "12345678": { h: sha256("1"), s: 10 }, b: { h: sha256("2"), s: 5 } },
      },
    };
    expect(Object.fromEntries(Object.entries(cases).map(([name, input]) => [name, tryParse(input, limits)])))
      .toMatchInlineSnapshot(`
        {
          "11-byte file": {
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
          "16 bytes total": {
            "code": "TOO_LARGE",
            "details": {
              "actual": 16,
              "limit": 15,
              "reason": "total",
            },
            "error": "SiteUploadError",
            "message": "The site is 16 bytes, over the 15-byte limit",
          },
          "4 files": {
            "code": "TOO_LARGE",
            "details": {
              "actual": 4,
              "limit": 3,
              "reason": "files",
            },
            "error": "SiteUploadError",
            "message": "4 files is over the 3-file limit",
          },
          "9-byte path": {
            "code": "INVALID_MANIFEST",
            "details": {
              "path": "123456789",
            },
            "error": "SiteUploadError",
            "message": "Path "123456789" is longer than 8 bytes",
          },
          "exactly the limits": {
            "files": {
              "12345678": {
                "h": "sha(1)",
                "s": 10,
              },
              "b": {
                "h": "sha(2)",
                "s": 5,
              },
            },
            "v": 1,
          },
        }
      `);
  });

  it("caps the file list's JSON size, so max-length paths can't build a huge pointer", () => {
    // 3,000 files with 1,000-byte paths: within the file and path limits, but
    // about 3 MB of JSON. A quote costs two bytes once escaped.
    const long = Array.from({ length: 3000 }, (_, i) => `${String(i).padStart(4, "0")}${"x".repeat(996)}`);
    const quoted = Array.from({ length: 1500 }, (_, i) => `${String(i).padStart(4, "0")}${'"'.repeat(996)}`);
    const small = { ...DEFAULT_LIMITS, maxManifestBytes: 200 };
    expect({
      "3,000 long paths": tryParse(withPaths(...long)),
      "1,500 paths of quotes": tryParse(withPaths(...quoted)),
      "two files under a 200-byte cap": tryParse(withPaths("a", "b"), small),
      "three files over it": tryParse(withPaths("a", "b", "c"), small),
    }).toMatchInlineSnapshot(`
      {
        "1,500 paths of quotes": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 3117000,
            "limit": 2097152,
            "reason": "manifest",
          },
          "error": "SiteUploadError",
          "message": "The file list is 3117000 bytes of JSON, over the 2097152-byte limit; use fewer files or shorter paths",
        },
        "3,000 long paths": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 3246000,
            "limit": 2097152,
            "reason": "manifest",
          },
          "error": "SiteUploadError",
          "message": "The file list is 3246000 bytes of JSON, over the 2097152-byte limit; use fewer files or shorter paths",
        },
        "three files over it": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 249,
            "limit": 200,
            "reason": "manifest",
          },
          "error": "SiteUploadError",
          "message": "The file list is 249 bytes of JSON, over the 200-byte limit; use fewer files or shorter paths",
        },
        "two files under a 200-byte cap": {
          "files": {
            "a": {
              "h": "sha(x)",
              "s": 1,
            },
            "b": {
              "h": "sha(x)",
              "s": 1,
            },
          },
          "v": 1,
        },
      }
    `);
  });

  it("handles the default maximum file count quickly", () => {
    const paths = Array.from({ length: DEFAULT_LIMITS.maxFiles }, (_, i) => `dir${i % 50}/file-${i}.txt`);
    const started = performance.now();
    parseManifest(withPaths(...paths));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("handles deep paths without quadratic blowup", () => {
    const deep = Array.from({ length: 2000 }, (_, i) => `${"d/".repeat(500)}f${i}`);
    const started = performance.now();
    parseManifest(withPaths(...deep), { ...DEFAULT_LIMITS, maxPathBytes: 2048, maxManifestBytes: 8 * 1024 * 1024 });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("hashSizes", () => {
  it("lists each hash once", () => {
    const { files } = manifestOf({ "a.txt": "same", "b.txt": "same", "c.txt": "other" });
    expect(readable(hashSizes(files))).toMatchInlineSnapshot(`
      Map {
        "sha(same)" => 4,
        "sha(other)" => 5,
      }
    `);
  });
});

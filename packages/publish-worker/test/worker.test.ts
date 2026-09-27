import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cacheControlFor,
  createWorker,
  DEFAULT_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  type Env,
} from "../src/serve";
import {
  createPointerCache,
  MAX_POINTER_BYTES,
  MAX_STALE_MS,
  MISS_REVALIDATE_MS,
  REVALIDATE_MS,
} from "../src/pointer";
import { createMemoryR2, type MemoryR2 } from "./memory-r2";

const OWNER = "owner_Secret123";
const WRITTEN = new Date("2026-09-01T12:00:00Z");

// sha256 hex of every body the tests publish, worked out once (Web Crypto is
// async; the Worker's types have no node:crypto).
const hashes = new Map<string, string>();
const hashOf = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  hashes.set(text, [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
};
const sha = (text: string) => {
  const hash = hashes.get(text);
  if (!hash) throw new Error(`no hash for ${text}`);
  return hash;
};

// `immutable`: the build named the file by its content ("i": 1 in the pointer).
type Files = Record<string, { body: string; type: string; immutable?: boolean }>;

const FILES: Files = {
  "index.html": { body: "<!doctype html><title>viewer</title>", type: "text/html; charset=utf-8" },
  "preview.html": { body: "<!doctype html><title>preview</title>", type: "text/html; charset=utf-8" },
  "canvas.json": { body: '{"version":1}', type: "application/json; charset=utf-8" },
  "assets/index-AbC12345.js": {
    body: "console.log(1)",
    type: "text/javascript; charset=utf-8",
    immutable: true,
  },
  "_antidraw/viewer.js": { body: "viewer()", type: "text/javascript; charset=utf-8", immutable: true },
  // A public file (public/assets/logo-original.png) whose name looks hashed.
  "assets/logo-original.png": { body: "logo", type: "image/png" },
  "clip.mp4": { body: "0123456789", type: "video/mp4" },
  "100%.png": { body: "png", type: "image/png" },
  "a b.txt": { body: "spaced", type: "text/plain; charset=utf-8" },
};

// Publishes `files` the way the server does: every content under
// c/<owner>/<sha256>, then the pointer.
const publish = (r2: MemoryR2, slug: string, files: Files, version = 1, written = WRITTEN) => {
  const entries: Record<string, { h: string; s: number; t: string; i?: 1 }> = {};
  for (const [path, { body, type, immutable }] of Object.entries(files)) {
    const h = sha(body);
    r2.put(`c/${OWNER}/${h}`, body);
    entries[path] = { h, s: new TextEncoder().encode(body).length, t: type };
    if (immutable) entries[path]!.i = 1;
  }
  r2.put(`m/${slug}.json`, JSON.stringify({ v: 1, version, u: OWNER, files: entries }), written);
};

const V2 = '{"version":2}';
const V2_INDEX = '<!doctype html><script src="/assets/index-NEWhash1.js"></script>';
const V2_CHUNK = "console.log(2)";
beforeAll(async () => {
  await Promise.all([...Object.values(FILES).map((f) => f.body), V2, V2_INDEX, V2_CHUNK].map(hashOf));
});

let r2: MemoryR2;
let time: number;
let worker: ReturnType<typeof createWorker>;
let env: Env;

beforeEach(() => {
  r2 = createMemoryR2();
  time = 1_000_000;
  worker = createWorker(createPointerCache(() => time));
  env = { SITES: r2.bucket, SITE_DOMAIN: "antidraw.app" };
  publish(r2, "site", FILES);
});

const fetchFrom = (
  from: ReturnType<typeof createWorker>,
  path: string,
  init: RequestInit = {},
  host = "site.antidraw.app",
) => from.fetch(new Request(`https://${host}${path}`, init) as never, env) as Promise<Response>;
const fetchSite = (path: string, init: RequestInit = {}, host = "site.antidraw.app") =>
  fetchFrom(worker, path, init, host);

const etagOf = (path: string) => `"${sha(FILES[path]!.body)}"`;

// No response, of any kind, names the owner.
const expectNoOwner = async (response: Response) => {
  const headers = JSON.stringify([...response.headers]);
  expect(headers).not.toContain(OWNER);
  const body = response.bodyUsed ? "" : await response.clone().text();
  expect(body).not.toContain(OWNER);
};

describe("routes", () => {
  test("/ is the viewer, with the manifest's type and the sha256 as its strong ETag", async () => {
    const response = await fetchSite("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FILES["index.html"]!.body);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("ETag")).toBe(etagOf("index.html"));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toBe(DEFAULT_CACHE_CONTROL);
    expect(response.headers.get("Last-Modified")).toBeNull();
    await expectNoOwner(response);
  });

  test("/preview is the workspace's Preview page", async () => {
    const response = await fetchSite("/preview");
    expect(await response.text()).toBe(FILES["preview.html"]!.body);
  });

  test("every other path is a file of the pointer", async () => {
    const response = await fetchSite("/canvas.json");
    expect(await response.text()).toBe(FILES["canvas.json"]!.body);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  test("paths are percent-decoded, and a stray % is kept", async () => {
    expect(await (await fetchSite("/a%20b.txt")).text()).toBe("spaced");
    expect(await (await fetchSite("/100%.png")).text()).toBe("png");
  });

  test("a file the pointer names in NFD (as macOS stores it) is served at its NFC URL, without a revalidation", async () => {
    const decomposed = "café.png".normalize("NFD");
    publish(r2, "site", { ...FILES, [decomposed]: { body: "png", type: "image/png" } });
    // How a browser sends <img src="/café.png"> typed in NFC.
    const composed = new URL("https://site.antidraw.app/café.png".normalize("NFC")).pathname;
    expect(composed).toBe("/caf%C3%A9.png");
    const response = await fetchSite(composed);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png");
    // And the NFD spelling still works.
    expect((await fetchSite(`/${encodeURIComponent(decomposed)}`)).status).toBe(200);
    // A hit: the pointer was read once, not re-checked as a miss.
    expect(r2.reads.filter((key) => key === "m/site.json")).toHaveLength(1);
  });

  test("hashed build output and the viewer's assets are immutable", async () => {
    for (const path of ["/assets/index-AbC12345.js", "/_antidraw/viewer.js"]) {
      const response = await fetchSite(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    }
  });

  test("a public file whose name looks hashed is not immutable: the build did not mark it", async () => {
    const response = await fetchSite("/assets/logo-original.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(DEFAULT_CACHE_CONTROL);
  });

  test("cacheControlFor", () => {
    expect(cacheControlFor("assets/index-AbC12345.js", true)).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(cacheControlFor("assets/nested/chunk-AbC_1-45.css", true)).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(cacheControlFor("_antidraw/any.js", true)).toBe(IMMUTABLE_CACHE_CONTROL);
    // Only what the build marked.
    expect(cacheControlFor("assets/index-AbC12345.js", false)).toBe(DEFAULT_CACHE_CONTROL);
    expect(cacheControlFor("_antidraw/any.js", false)).toBe(DEFAULT_CACHE_CONTROL);
    // And only where such files are named, whatever the mark.
    expect(cacheControlFor("assets/logo.png", true)).toBe(DEFAULT_CACHE_CONTROL);
    expect(cacheControlFor("public/assets/index-AbC12345.js", true)).toBe(DEFAULT_CACHE_CONTROL);
    expect(cacheControlFor("index.html", true)).toBe(DEFAULT_CACHE_CONTROL);
    expect(cacheControlFor("canvas.json", true)).toBe(DEFAULT_CACHE_CONTROL);
  });
});

describe("not found", () => {
  test("a path the pointer does not list is a 404, and R2 is never read by request path", async () => {
    // Content that exists in the bucket under the requested path's own key.
    r2.put("site/secret.txt", "old layout");
    r2.put(`c/${OWNER}/secret.txt`, "not a site file");
    for (const path of ["/secret.txt", "/missing.js", "/constructor", "/__proto__", "/../m/site.json"]) {
      const response = await fetchSite(path);
      expect(response.status).toBe(404);
      await expectNoOwner(response);
    }
    expect(r2.reads.every((key) => key === "m/site.json")).toBe(true);
  });

  test("a 404 is not cached", async () => {
    const missing = await fetchSite("/missing.js");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    const noSite = await fetchSite("/", {}, "nosite.antidraw.app");
    expect(noSite.headers.get("Cache-Control")).toBe("no-store");
  });

  test("a site with no pointer is a 404", async () => {
    const response = await fetchSite("/", {}, "nosite.antidraw.app");
    expect(response.status).toBe(404);
    expect(r2.reads).toEqual(["m/nosite.json"]);
  });

  test("hosts that are not one label under the site domain are a 404, without an R2 read", async () => {
    for (const host of ["antidraw.app", "a.site.antidraw.app", "site.example.com", "-x.antidraw.app"]) {
      expect((await fetchSite("/", {}, host)).status).toBe(404);
    }
    expect(r2.reads).toEqual([]);
  });

  test("a pointer entry whose content is missing is a 404", async () => {
    r2.delete(`c/${OWNER}/${sha(FILES["canvas.json"]!.body)}`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await fetchSite("/canvas.json");
    expect(response.status).toBe(404);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(OWNER);
    errors.mockRestore();
  });

  test("methods other than GET and HEAD are a 405", async () => {
    const response = await fetchSite("/", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});

describe("publishing again", () => {
  test("a new pointer is served within the revalidation window, with the new content", async () => {
    expect(await (await fetchSite("/canvas.json")).text()).toBe('{"version":1}');
    publish(r2, "site", { ...FILES, "canvas.json": { body: V2, type: "application/json" } }, 2);
    // Still the cached pointer inside the window.
    expect(await (await fetchSite("/canvas.json")).text()).toBe('{"version":1}');
    time += REVALIDATE_MS;
    const response = await fetchSite("/canvas.json");
    expect(await response.text()).toBe(V2);
    expect(response.headers.get("ETag")).toBe(`"${sha(V2)}"`);
  });

  // Two isolates, each with its own pointer cache, over one bucket.
  const V2_FILES: Files = {
    ...FILES,
    "index.html": { body: V2_INDEX, type: "text/html; charset=utf-8" },
    "assets/index-NEWhash1.js": { body: V2_CHUNK, type: "text/javascript; charset=utf-8", immutable: true },
  };

  test("a file only the new pointer has is served by an isolate still holding the old one", async () => {
    const isolateA = worker;
    const isolateB = createWorker(createPointerCache(() => time));
    // B caches version 1.
    expect((await fetchFrom(isolateB, "/")).status).toBe(200);
    time += 1_000;
    publish(r2, "site", V2_FILES, 2);
    // A reads version 2 and serves its page, which names the new chunk.
    expect(await (await fetchFrom(isolateA, "/")).text()).toBe(V2_INDEX);
    time += 1_000;
    // The chunk request lands on B, whose version 1 is 2 s old: inside the
    // revalidation window, but a miss asks R2 again.
    const chunk = await fetchFrom(isolateB, "/assets/index-NEWhash1.js");
    expect(chunk.status).toBe(200);
    expect(await chunk.text()).toBe(V2_CHUNK);
    // And B now serves version 2 throughout.
    expect(await (await fetchFrom(isolateB, "/")).text()).toBe(V2_INDEX);
  });

  test("a site's first publish is served by an isolate that cached it as missing", async () => {
    expect((await fetchSite("/", {}, "fresh.antidraw.app")).status).toBe(404);
    time += MISS_REVALIDATE_MS;
    publish(r2, "fresh", FILES);
    expect((await fetchSite("/", {}, "fresh.antidraw.app")).status).toBe(200);
  });

  test("a stream of 404s reads the pointer at most once per MISS_REVALIDATE_MS", async () => {
    await fetchSite("/");
    time += MISS_REVALIDATE_MS;
    const before = r2.reads.length;
    // 100 missing paths over 10 floors' worth of time, in parallel bursts.
    for (let burst = 0; burst < 20; burst++) {
      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, n) => fetchSite(`/missing-${burst}-${n}.js`)),
      );
      expect(responses.every((r) => r.status === 404)).toBe(true);
      time += MISS_REVALIDATE_MS / 2;
    }
    const reads = r2.reads.slice(before);
    // Every burst without the floor, every request without the shared read.
    expect(reads.length).toBeLessThanOrEqual(10);
    expect(reads.every((key) => key === "m/site.json")).toBe(true);
  });

  test("a miss right after a check reads nothing more", async () => {
    await fetchSite("/");
    expect((await fetchSite("/missing.js")).status).toBe(404);
    time += MISS_REVALIDATE_MS - 1;
    expect((await fetchSite("/missing.js")).status).toBe(404);
    expect(r2.reads).toEqual(["m/site.json", `c/${OWNER}/${sha(FILES["index.html"]!.body)}`]);
  });
});

describe("HEAD", () => {
  test("answers with the headers and Content-Length, and reads no content", async () => {
    const response = await fetchSite("/clip.mp4", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("ETag")).toBe(etagOf("clip.mp4"));
    expect(await response.text()).toBe("");
    expect(r2.reads).toEqual(["m/site.json"]);
  });

  test("ignores Range", async () => {
    const response = await fetchSite("/clip.mp4", { method: "HEAD", headers: { Range: "bytes=0-1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
  });
});

describe("preconditions (RFC 9110 order)", () => {
  const status = async (headers: Record<string, string>, method = "GET") =>
    (await fetchSite("/clip.mp4", { method, headers })).status;
  const etag = () => etagOf("clip.mp4");
  const before = new Date(WRITTEN.getTime() - 60_000).toUTCString();
  const after = new Date(WRITTEN.getTime() + 60_000).toUTCString();

  test("If-None-Match: a matching tag (weakly compared) or * is a 304", async () => {
    expect(await status({ "If-None-Match": etag() })).toBe(304);
    expect(await status({ "If-None-Match": `"x", W/${etag()}` })).toBe(304);
    expect(await status({ "If-None-Match": "*" })).toBe(304);
    expect(await status({ "If-None-Match": '"other"' })).toBe(200);
    expect(await status({ "If-None-Match": etag() }, "HEAD")).toBe(304);
  });

  test("a 304 carries the validators and no body", async () => {
    const response = await fetchSite("/clip.mp4", { headers: { "If-None-Match": etag() } });
    expect(response.headers.get("ETag")).toBe(etag());
    expect(response.headers.get("Cache-Control")).toBe(DEFAULT_CACHE_CONTROL);
    expect(await response.text()).toBe("");
    expect(r2.reads).toEqual(["m/site.json"]);
  });

  test("If-Match: strong comparison; a mismatch or a weak tag is a 412", async () => {
    expect(await status({ "If-Match": etag() })).toBe(200);
    expect(await status({ "If-Match": "*" })).toBe(200);
    expect(await status({ "If-Match": '"other"' })).toBe(412);
    expect(await status({ "If-Match": `W/${etag()}` })).toBe(412);
  });

  test("malformed conditional headers are ignored", async () => {
    expect(await status({ "If-Match": "not-a-tag" })).toBe(200);
    expect(await status({ "If-None-Match": "garbage" })).toBe(200);
    expect(await status({ "If-Modified-Since": "yesterday-ish" })).toBe(200);
    expect(await status({ "If-Unmodified-Since": "nope" })).toBe(200);
  });

  test("dates compare against when the pointer was written, by the second", async () => {
    expect(await status({ "If-Modified-Since": WRITTEN.toUTCString() })).toBe(304);
    expect(await status({ "If-Modified-Since": after })).toBe(304);
    expect(await status({ "If-Modified-Since": before })).toBe(200);
    expect(await status({ "If-Unmodified-Since": WRITTEN.toUTCString() })).toBe(200);
    expect(await status({ "If-Unmodified-Since": before })).toBe(412);
  });

  test("If-Match wins over If-Unmodified-Since, If-None-Match over If-Modified-Since", async () => {
    expect(await status({ "If-Match": etag(), "If-Unmodified-Since": before })).toBe(200);
    expect(await status({ "If-None-Match": '"other"', "If-Modified-Since": after })).toBe(200);
  });

  test("a 412 comes before a 304", async () => {
    expect(await status({ "If-Match": '"other"', "If-None-Match": etag() })).toBe(412);
  });

  test("preconditions come before a Range", async () => {
    expect(await status({ "If-None-Match": etag(), Range: "bytes=0-1" })).toBe(304);
    expect(await status({ "If-Match": '"other"', Range: "bytes=0-1" })).toBe(412);
  });
});

describe("Range", () => {
  const get = (headers: Record<string, string>) => fetchSite("/clip.mp4", { headers });

  test("one byte range is a 206 with its Content-Range", async () => {
    const response = await get({ Range: "bytes=2-5" });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("ETag")).toBe(etagOf("clip.mp4"));
    expect(await response.text()).toBe("2345");
  });

  test("open-ended, suffix, and past-the-end ranges", async () => {
    expect(await (await get({ Range: "bytes=7-" })).text()).toBe("789");
    expect(await (await get({ Range: "bytes=-3" })).text()).toBe("789");
    expect(await (await get({ Range: "bytes=-30" })).text()).toBe("0123456789");
    const clipped = await get({ Range: "bytes=8-100" });
    expect(clipped.headers.get("Content-Range")).toBe("bytes 8-9/10");
    expect(await clipped.text()).toBe("89");
  });

  test("an unsatisfiable range is a 416", async () => {
    for (const range of ["bytes=10-", "bytes=-0"]) {
      const response = await get({ Range: range });
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
    }
  });

  test("several ranges, or one that does not parse, get the whole file", async () => {
    for (const range of ["bytes=0-1,4-5", "bytes=5-2", "items=0-1", "bytes=-"]) {
      const response = await get({ Range: range });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("0123456789");
    }
  });

  test("If-Range: the current ETag gets the range; anything else gets the whole file", async () => {
    expect((await get({ Range: "bytes=0-1", "If-Range": etagOf("clip.mp4") })).status).toBe(206);
    expect((await get({ Range: "bytes=0-1", "If-Range": '"old"' })).status).toBe(200);
    expect((await get({ Range: "bytes=0-1", "If-Range": `W/${etagOf("clip.mp4")}` })).status).toBe(200);
    expect((await get({ Range: "bytes=0-1", "If-Range": WRITTEN.toUTCString() })).status).toBe(200);
  });
});

describe("R2 failures", () => {
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  test("a failed pointer read is a 503 with Retry-After", async () => {
    const errors = quiet();
    r2.fail((key) => key.startsWith("m/"));
    const response = await fetchSite("/");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    await expectNoOwner(response);
    errors.mockRestore();
  });

  test("a failed content read is a 503, and the log does not name the owner", async () => {
    const errors = quiet();
    r2.fail((key) => key.startsWith("c/"));
    const response = await fetchSite("/");
    expect(response.status).toBe(503);
    await expectNoOwner(response);
    expect(JSON.stringify(errors.mock.calls.map((call) => String(call[0])))).not.toContain(OWNER);
    errors.mockRestore();
  });

  test("a malformed pointer, or a malformed entry, is a 503", async () => {
    const errors = quiet();
    r2.put("m/broken.json", "{");
    expect((await fetchSite("/", {}, "broken.antidraw.app")).status).toBe(503);
    r2.put(
      "m/bad-entry.json",
      JSON.stringify({ v: 1, version: 1, u: OWNER, files: { "index.html": { h: "x", s: 1, t: "text/html" } } }),
    );
    const response = await fetchSite("/", {}, "bad-entry.antidraw.app");
    expect(response.status).toBe(503);
    await expectNoOwner(response);
    errors.mockRestore();
  });

  test("a pointer past MAX_POINTER_BYTES is a 503, and its body is not read", async () => {
    const errors = quiet();
    const pad = "x".repeat(MAX_POINTER_BYTES);
    r2.put("m/huge.json", JSON.stringify({ v: 1, version: 1, u: OWNER, files: {}, pad }));
    const response = await fetchSite("/", {}, "huge.antidraw.app");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    errors.mockRestore();
  });

  test("a cached site is served as cached while its pointer cannot be read, for up to MAX_STALE_MS", async () => {
    const errors = quiet();
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await fetchSite("/")).status).toBe(200);
    r2.fail((key) => key.startsWith("m/"));
    time += REVALIDATE_MS;
    const response = await fetchSite("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FILES["index.html"]!.body);
    // The warning names the site, never the owner.
    expect(JSON.stringify(warnings.mock.calls.map((call) => call.map(String)))).not.toContain(OWNER);
    time += MAX_STALE_MS;
    expect((await fetchSite("/")).status).toBe(503);
    errors.mockRestore();
    warnings.mockRestore();
  });

  test("the site recovers once R2 does", async () => {
    const errors = quiet();
    r2.fail(() => true);
    expect((await fetchSite("/")).status).toBe(503);
    r2.fail(null);
    expect((await fetchSite("/")).status).toBe(200);
    errors.mockRestore();
  });
});

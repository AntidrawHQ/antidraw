import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bytes,
  startTestWorker,
  manifestOf,
  sha256,
  summarize,
  uniqueSite,
  type TestWorker,
} from "../../test/helpers";
import { SiteServer, type FileCache, type SiteServerOptions } from "./serve";
import { SiteStore } from "./store";

let env: TestWorker;
let clock: number;
let store: SiteStore;
let site: string;

beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

beforeEach(() => {
  clock = Date.now();
  store = new SiteStore({ bucket: env.bucket, now: () => clock });
  site = uniqueSite();
});

async function publish(publishId: string, contents: Record<string, string>, immutable: string[] = []) {
  const { missing } = await store.plan(site, publishId, manifestOf(contents, immutable));
  for (const content of new Set(Object.values(contents))) {
    if (!missing.includes(sha256(content))) continue;
    const body = bytes(content);
    await store.putFile(site, publishId, sha256(content), body, body.length);
  }
  await store.commit(site, publishId);
}

const server = (options: Partial<SiteServerOptions> = {}) => new SiteServer({ store, now: () => clock, ...options });

const get = (s: SiteServer, path: string, init: RequestInit = {}) =>
  s.fetch(new Request(`https://example.test${path}`, init), site);

/** Fetches each path and summarizes every response, for one snapshot. */
async function fetchAll(s: SiteServer, requests: Record<string, [string, RequestInit?]>) {
  const out: Record<string, unknown> = {};
  for (const [name, [path, init]] of Object.entries(requests)) out[name] = await summarize(await get(s, path, init));
  return out;
}

const SITE = {
  "index.html": "<h1>home</h1>",
  "about/index.html": "<h1>about</h1>",
  "assets/app-1a2b3c4d.js": "console.log(1)",
  "docs/é ü.txt": "unicode",
  "404.html": "<h1>missing</h1>",
  "video.mp4": "0123456789",
};

describe("resolving paths", () => {
  beforeEach(() => publish("p1", SITE, ["assets/app-1a2b3c4d.js"]));

  it("serves pages, folders, assets and unicode paths", async () => {
    expect(
      await fetchAll(server(), {
        root: ["/"],
        "folder with slash": ["/about/"],
        "folder without slash": ["/about?x=1"],
        "hashed asset": ["/assets/app-1a2b3c4d.js"],
        "percent-encoded NFC": ["/docs/%C3%A9%20%C3%BC.txt"],
        "percent-encoded NFD": [`/docs/${encodeURIComponent("é ü.txt")}`],
      }),
    ).toMatchInlineSnapshot(`
      {
        "folder with slash": {
          "body": "<h1>about</h1>",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "14",
            "content-type": "text/html; charset=utf-8",
            "etag": ""sha(<h1>about</h1>)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "folder without slash": {
          "body": "",
          "headers": {
            "cache-control": "public, max-age=0, must-revalidate",
            "location": "/about/?x=1",
          },
          "status": 308,
        },
        "hashed asset": {
          "body": "console.log(1)",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=31536000, immutable",
            "content-length": "14",
            "content-type": "text/javascript; charset=utf-8",
            "etag": ""sha(console.log(1))"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "percent-encoded NFC": {
          "body": "unicode",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "7",
            "content-type": "text/plain; charset=utf-8",
            "etag": ""sha(unicode)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "percent-encoded NFD": {
          "body": "unicode",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "7",
            "content-type": "text/plain; charset=utf-8",
            "etag": ""sha(unicode)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "root": {
          "body": "<h1>home</h1>",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "13",
            "content-type": "text/html; charset=utf-8",
            "etag": ""sha(<h1>home</h1>)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
      }
    `);
  });

  it("answers errors and unknown paths", async () => {
    expect(
      await fetchAll(server(), {
        unknown: ["/nope"],
        "bad percent-encoding": ["/%E0%A4%A"],
        "dot segments stay inside the site": ["/about/../../../index.html"],
        "encoded dot segments": ["/%2e%2e/current.json"],
        post: ["/", { method: "POST" }],
        head: ["/video.mp4", { method: "HEAD" }],
      }),
    ).toMatchInlineSnapshot(`
      {
        "bad percent-encoding": {
          "body": "Bad request",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
          "status": 400,
        },
        "dot segments stay inside the site": {
          "body": "<h1>home</h1>",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "13",
            "content-type": "text/html; charset=utf-8",
            "etag": ""sha(<h1>home</h1>)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "encoded dot segments": {
          "body": "<h1>missing</h1>",
          "headers": {
            "cache-control": "no-store",
            "content-length": "16",
            "content-type": "text/html; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
          "status": 404,
        },
        "head": {
          "body": "",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "post": {
          "body": "Method not allowed",
          "headers": {
            "allow": "GET, HEAD",
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
          "status": 405,
        },
        "unknown": {
          "body": "<h1>missing</h1>",
          "headers": {
            "cache-control": "no-store",
            "content-length": "16",
            "content-type": "text/html; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
          "status": 404,
        },
      }
    `);
  });
});

describe("not-found modes", () => {
  it("serves a plain 404 when the site has no 404.html, or was never published", async () => {
    const neverPublished = await summarize(await get(server(), "/"));
    await publish("p1", { "index.html": "home" });
    expect({ neverPublished, no404Page: await summarize(await get(server(), "/nope")) }).toMatchInlineSnapshot(`
      {
        "neverPublished": {
          "body": "Not found",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
          "status": 404,
        },
        "no404Page": {
          "body": "Not found",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
          "status": 404,
        },
      }
    `);
  });

  it("falls back to index.html in single-page-application mode, for paths without an extension", async () => {
    await publish("p1", { "index.html": "app", "404.html": "missing" });
    expect(
      await fetchAll(server({ notFound: "single-page-application" }), {
        route: ["/users/42"],
        "missing file": ["/missing.js"],
      }),
    ).toMatchInlineSnapshot(`
      {
        "missing file": {
          "body": "Not found",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
          "status": 404,
        },
        "route": {
          "body": "app",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "3",
            "content-type": "text/html; charset=utf-8",
            "etag": ""sha(app)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
      }
    `);
  });
});

describe("cache-control", () => {
  // `i` is the uploader's claim, so a publish can flag its pages too.
  const flagged = { "index.html": "home", "about/index.html": "about", "page.html": "page", "app-1.js": "js" };
  const cacheControl = async (s: SiteServer, paths: string[]) => {
    const out: Record<string, string | null> = {};
    for (const path of paths) out[path] = (await get(s, path)).headers.get("cache-control");
    return out;
  };

  it("never lets an upload pin HTML: pages, directory indexes and the SPA fallback revalidate", async () => {
    await publish("p1", flagged, Object.keys(flagged));
    const spa = server({ notFound: "single-page-application" });
    expect(await cacheControl(spa, ["/", "/about/", "/page.html", "/route", "/app-1.js"])).toMatchInlineSnapshot(`
      {
        "/": "public, max-age=0, must-revalidate",
        "/about/": "public, max-age=0, must-revalidate",
        "/app-1.js": "public, max-age=31536000, immutable",
        "/page.html": "public, max-age=0, must-revalidate",
        "/route": "public, max-age=0, must-revalidate",
      }
    `);
  });

  it("lets the caller decide, e.g. private for a members-only site", async () => {
    await publish("p1", flagged, ["app-1.js"]);
    const seen: unknown[] = [];
    const s = server({
      cacheControl: (file) => {
        seen.push({ ...file, site: file.site === site ? "<site>" : file.site });
        return file.immutable ? "private, max-age=31536000, immutable" : "private, no-cache";
      },
    });
    expect({
      served: await cacheControl(s, ["/", "/app-1.js"]),
      notModified: (await get(s, "/", { headers: { "if-none-match": `"${sha256("home")}"` } })).headers.get(
        "cache-control",
      ),
      seen,
    }).toMatchInlineSnapshot(`
      {
        "notModified": "private, no-cache",
        "seen": [
          {
            "immutable": false,
            "path": "index.html",
            "site": "<site>",
          },
          {
            "immutable": true,
            "path": "app-1.js",
            "site": "<site>",
          },
          {
            "immutable": false,
            "path": "index.html",
            "site": "<site>",
          },
        ],
        "served": {
          "/": "private, no-cache",
          "/app-1.js": "private, max-age=31536000, immutable",
        },
      }
    `);
  });
});

describe("service workers", () => {
  const WORKER = { headers: { "service-worker": "script" } };
  // What a browser's install or update check for a worker script gets back.
  const script = async (s: SiteServer, path: string, key = site) => {
    const response = await s.fetch(new Request(`https://example.test${path}`, WORKER), key);
    const body = await response.text();
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      body: body.includes("unregister()") ? "<unregisters itself>" : body,
    };
  };

  it("are off by default: a worker script request gets one that unregisters itself", async () => {
    await publish("p1", { "index.html": "home", "sw.js": "attacker worker" });
    const s = server();
    expect({
      worker: await script(s, "/sw.js"),
      "same file, as a plain request": (await get(s, "/sw.js")).status,
      "never published": await script(s, "/sw.js", uniqueSite()),
    }).toMatchInlineSnapshot(`
      {
        "never published": {
          "body": "<unregisters itself>",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
        "same file, as a plain request": 200,
        "worker": {
          "body": "<unregisters itself>",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
      }
    `);
  });

  it("when allowed, serve only live files; a worker the live version dropped is unregistered", async () => {
    const other = uniqueSite();
    const s = server({ serviceWorkers: (key) => key === site });
    await publish("p1", { "index.html": "home", "sw.js": "old worker" }, ["sw.js"]);
    const live = await script(s, "/sw.js");
    clock += 10_000;
    // A teammate is removed and the site republished without their worker.
    // It is flagged immutable, so it stays servable as a retained file.
    await publish("p2", { "index.html": "home 2", "about/index.html": "about" });
    expect({
      live,
      "dropped by the next publish": await script(s, "/sw.js"),
      "retained, as a plain request": (await get(s, "/sw.js")).status,
      "never uploaded": await script(s, "/other-sw.js"),
      "a folder that redirects": await script(s, "/about"),
      "a site not allowed them": await script(s, "/sw.js", other),
    }).toMatchInlineSnapshot(`
      {
        "a folder that redirects": {
          "body": "<unregisters itself>",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
        "a site not allowed them": {
          "body": "<unregisters itself>",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
        "dropped by the next publish": {
          "body": "<unregisters itself>",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
        "live": {
          "body": "old worker",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
        "never uploaded": {
          "body": "<unregisters itself>",
          "status": 200,
          "type": "text/javascript; charset=utf-8",
        },
        "retained, as a plain request": 200,
      }
    `);
  });
});

describe("conditional requests and ranges", () => {
  beforeEach(() => publish("p1", SITE));
  const homeTag = `"${sha256("<h1>home</h1>")}"`;
  const videoTag = `"${sha256("0123456789")}"`;

  it("answers If-None-Match", async () => {
    expect(
      await fetchAll(server(), {
        "weak match": ["/", { headers: { "if-none-match": `W/${homeTag}` } }],
        "one of several": ["/", { headers: { "if-none-match": `"x", ${homeTag}` } }],
        "no match": ["/", { headers: { "if-none-match": '"other"' } }],
      }),
    ).toMatchInlineSnapshot(`
      {
        "no match": {
          "body": "<h1>home</h1>",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "13",
            "content-type": "text/html; charset=utf-8",
            "etag": ""sha(<h1>home</h1>)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "one of several": {
          "body": "",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "etag": ""sha(<h1>home</h1>)"",
            "x-content-type-options": "nosniff",
          },
          "status": 304,
        },
        "weak match": {
          "body": "",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "etag": ""sha(<h1>home</h1>)"",
            "x-content-type-options": "nosniff",
          },
          "status": 304,
        },
      }
    `);
  });

  it("serves byte ranges", async () => {
    const range = (value: string, extra: Record<string, string> = {}): [string, RequestInit] => [
      "/video.mp4",
      { headers: { range: value, ...extra } },
    ];
    expect(
      await fetchAll(server(), {
        "bytes=2-4": range("bytes=2-4"),
        "bytes=-3": range("bytes=-3"),
        "bytes=8-": range("bytes=8-"),
        "past the end": range("bytes=10-"),
        "multiple ranges": range("bytes=0-1,4-5"),
        "If-Range matches": range("bytes=0-1", { "if-range": videoTag }),
        "If-Range stale": range("bytes=0-1", { "if-range": '"old"' }),
        "ranged HEAD": ["/video.mp4", { method: "HEAD", headers: { range: "bytes=0-3" } }],
      }),
    ).toMatchInlineSnapshot(`
      {
        "If-Range matches": {
          "body": "01",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "2",
            "content-range": "bytes 0-1/10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 206,
        },
        "If-Range stale": {
          "body": "0123456789",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "bytes=-3": {
          "body": "789",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "3",
            "content-range": "bytes 7-9/10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 206,
        },
        "bytes=2-4": {
          "body": "234",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "3",
            "content-range": "bytes 2-4/10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 206,
        },
        "bytes=8-": {
          "body": "89",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "2",
            "content-range": "bytes 8-9/10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 206,
        },
        "multiple ranges": {
          "body": "0123456789",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
        "past the end": {
          "body": "",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-range": "bytes */10",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 416,
        },
        "ranged HEAD": {
          "body": "",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "4",
            "content-range": "bytes 0-3/10",
            "content-type": "video/mp4",
            "etag": ""sha(0123456789)"",
            "x-content-type-options": "nosniff",
          },
          "status": 206,
        },
      }
    `);
  });
});

describe("pointer cache", () => {
  const body = async (s: SiteServer, path = "/") => (await get(s, path)).text();

  it("keeps serving the cached version until the TTL passes", async () => {
    await publish("p1", { "index.html": "v1" });
    const s = server({ pointerTtlMs: 5000 });
    const seen = [await body(s)];
    await publish("p2", { "index.html": "v2" });
    seen.push(await body(s));
    clock += 4999;
    seen.push(await body(s));
    clock += 1;
    seen.push(await body(s));
    expect(seen).toMatchInlineSnapshot(`
      [
        "v1",
        "v1",
        "v1",
        "v2",
      ]
    `);
  });

  it("re-reads the pointer on a miss, so new files are found right away", async () => {
    await publish("p1", { "index.html": "v1" });
    const s = server({ pointerTtlMs: 60_000 });
    await get(s, "/");
    await publish("p2", { "index.html": "v2", "assets/new-chunk.js": "new" });
    clock += 1000;
    expect(await summarize(await get(s, "/assets/new-chunk.js"))).toMatchInlineSnapshot(`
      {
        "body": "new",
        "headers": {
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=0, must-revalidate",
          "content-length": "3",
          "content-type": "text/javascript; charset=utf-8",
          "etag": ""sha(new)"",
          "x-content-type-options": "nosniff",
        },
        "status": 200,
      }
    `);
  });

  it("re-reads at most once a second on misses", async () => {
    await publish("p1", { "index.html": "v1" });
    let reads = 0;
    const counting = new SiteStore({ bucket: env.bucket, now: () => clock });
    const read = counting.readPointerSized.bind(counting);
    counting.readPointerSized = (s) => {
      reads++;
      return read(s);
    };
    const s = new SiteServer({ store: counting, now: () => clock });
    await get(s, "/");
    for (let i = 0; i < 5; i++) await get(s, `/missing-${i}`);
    const withinASecond = reads;
    clock += 1000;
    await get(s, "/missing-again");
    expect({ withinASecond, afterASecond: reads }).toMatchInlineSnapshot(`
      {
        "afterASecond": 2,
        "withinASecond": 1,
      }
    `);
  });

  it("forgets the least recently used site past the limit", async () => {
    await publish("p1", { "index.html": "first site v1" });
    const first = site;
    site = uniqueSite();
    await publish("p1", { "index.html": "second site" });
    const second = site;

    const s = server({ maxCachedSites: 1, pointerTtlMs: 60_000 });
    const home = async (key: string) => (await s.fetch(new Request("https://x.test/"), key)).text();
    const seen = [await home(first), await home(second)];
    site = first;
    await publish("p2", { "index.html": "first site v2" });
    // The first site was evicted when the second was cached, so v2 shows at once.
    seen.push(await home(first));
    expect(seen).toMatchInlineSnapshot(`
      [
        "first site v1",
        "second site",
        "first site v2",
      ]
    `);
  });
});

describe("retained files", () => {
  it("serves the previous version's hashed chunks, but nothing else from it", async () => {
    await publish("p1", { "index.html": "v1", "assets/app-1.js": "js1", "about.txt": "old page" }, ["assets/app-1.js"]);
    await publish("p2", { "index.html": "v2", "assets/app-2.js": "js2" }, ["assets/app-2.js"]);
    const afterOne = await fetchAll(server(), {
      "old chunk": ["/assets/app-1.js"],
      "old non-hashed file": ["/about.txt"],
    });
    await publish("p3", { "index.html": "v3", "assets/app-3.js": "js3" }, ["assets/app-3.js"]);
    const afterTwo = await summarize(await get(server(), "/assets/app-1.js"));
    expect({ afterOne, afterTwo: afterTwo.status }).toMatchInlineSnapshot(`
      {
        "afterOne": {
          "old chunk": {
            "body": "js1",
            "headers": {
              "accept-ranges": "bytes",
              "cache-control": "public, max-age=31536000, immutable",
              "content-length": "3",
              "content-type": "text/javascript; charset=utf-8",
              "etag": ""sha(js1)"",
              "x-content-type-options": "nosniff",
            },
            "status": 200,
          },
          "old non-hashed file": {
            "body": "Not found",
            "headers": {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
            },
            "status": 404,
          },
        },
        "afterTwo": 404,
      }
    `);
  });
});

describe("failures", () => {
  it("answers 404 for an invalid site key and 503 when the pointer can't be read", async () => {
    const failing = new SiteStore({ bucket: env.bucket, now: () => clock });
    failing.readPointerSized = async () => {
      throw new Error("R2 is down");
    };
    expect({
      invalidSite: await summarize(await server().fetch(new Request("https://x.test/"), "../etc")),
      readFails: await summarize(await new SiteServer({ store: failing }).fetch(new Request("https://x.test/"), site)),
    }).toMatchInlineSnapshot(`
      {
        "invalidSite": {
          "body": "Not found",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
          "status": 404,
        },
        "readFails": {
          "body": "Temporarily unavailable",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "retry-after": "1",
          },
          "status": 503,
        },
      }
    `);
  });

  it("re-reads a stale pointer when its file is gone from storage", async () => {
    await publish("p1", { "index.html": "v1" });
    const s = server({ pointerTtlMs: 60 * 60 * 1000 });
    await (await get(s, "/")).text();
    await publish("p2", { "index.html": "v2" });
    // v1 is deleted once it's past the grace period and no version uses it.
    const later = new SiteStore({ bucket: env.bucket, now: () => clock + 2 * 60 * 60 * 1000 });
    const cleaned = await later.cleanup(site);
    expect({ cleaned, response: await summarize(await get(s, "/")) }).toMatchInlineSnapshot(`
      {
        "cleaned": {
          "deletedFiles": 1,
          "deletedPlans": 1,
        },
        "response": {
          "body": "v2",
          "headers": {
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-length": "2",
            "content-type": "text/html; charset=utf-8",
            "etag": ""sha(v2)"",
            "x-content-type-options": "nosniff",
          },
          "status": 200,
        },
      }
    `);
  });
});

describe("pointer reads", () => {
  it("shares one read between requests that arrive together", async () => {
    await publish("p1", { "index.html": "v1" });
    let reads = 0;
    const counting = new SiteStore({ bucket: env.bucket, now: () => clock });
    const read = counting.readPointerSized.bind(counting);
    counting.readPointerSized = (s) => {
      reads++;
      return read(s);
    };
    const s = new SiteServer({ store: counting, now: () => clock });
    const bodies = await Promise.all(Array.from({ length: 10 }, async () => (await get(s, "/")).text()));
    expect({ reads, bodies: [...new Set(bodies)] }).toMatchInlineSnapshot(`
      {
        "bodies": [
          "v1",
        ],
        "reads": 1,
      }
    `);
  });

  it("evicts pointers past the byte budget", async () => {
    await publish("p1", { "index.html": "first" });
    const first = site;
    site = uniqueSite();
    await publish("p1", { "index.html": "second" });
    const second = site;

    let reads = 0;
    const counting = new SiteStore({ bucket: env.bucket, now: () => clock });
    const read = counting.readPointerSized.bind(counting);
    counting.readPointerSized = (s) => {
      reads++;
      return read(s);
    };
    // Room for one small pointer, not two.
    const s = new SiteServer({ store: counting, now: () => clock, pointerTtlMs: 60_000, maxCachedPointerBytes: 200 });
    const visit = async (key: string) => (await s.fetch(new Request("https://x.test/"), key)).text();
    const seen = [await visit(first), await visit(first), await visit(second), await visit(first)];
    expect({ seen, reads }).toMatchInlineSnapshot(`
      {
        "reads": 3,
        "seen": [
          "first",
          "first",
          "second",
          "first",
        ],
      }
    `);
  });
});

describe("file cache", () => {
  /** A cache that never keeps anything, like the Cache API on workers.dev. */
  function forgetfulCache() {
    const log = { matches: 0, puts: 0 };
    const cache: FileCache = {
      async match() {
        log.matches++;
        return undefined;
      },
      async put(_request, response) {
        log.puts++;
        await response.arrayBuffer();
      },
    };
    return { cache, log };
  }

  it("is off unless given one", async () => {
    await publish("p1", { "index.html": "v1" });
    const pending: Promise<unknown>[] = [];
    const body = await (await server().fetch(new Request("https://x.test/"), site, { waitUntil: (p) => pending.push(p) })).text();
    expect({ body, cacheFills: pending.length }).toMatchInlineSnapshot(`
      {
        "body": "v1",
        "cacheFills": 0,
      }
    `);
  });

  it("fills each file at most once per isolate, even if the cache keeps nothing", async () => {
    await publish("p1", { "index.html": "v1" });
    const { cache, log } = forgetfulCache();
    const s = server({ cache });
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    for (let i = 0; i < 3; i++) {
      await (await s.fetch(new Request("https://x.test/"), site, ctx)).text();
      await Promise.all(pending);
    }
    expect(log).toMatchInlineSnapshot(`
      {
        "matches": 3,
        "puts": 1,
      }
    `);
  });
});

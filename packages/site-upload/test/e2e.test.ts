import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpTransport, uploadSite } from "../src/client";
import { readable, sha256, startTestWorker, summarize, uniqueSite, type TestWorker } from "./helpers";

// The server half runs in workerd behind real HTTP (without nodejs_compat, so
// a Node import in src/server stops the Worker from starting); the client runs
// in Node and streams files from disk. Nothing here is mocked.

let worker: TestWorker;
let origin: string;
let dir: string;
let site: string;
let publishCount: number;

beforeAll(async () => {
  worker = await startTestWorker();
  origin = worker.url.origin;
});
afterAll(() => worker?.close());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "site-upload-e2e-"));
  site = uniqueSite("e2e");
  publishCount = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function write(files: Record<string, string | Uint8Array>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
    sha256(content);
  }
}

async function publish(extra: Partial<Parameters<typeof uploadSite>[0]> = {}) {
  const publishId = `p${++publishCount}`;
  const transport = createHttpTransport({ baseUrl: `${origin}/_upload/${site}/${publishId}` });
  return uploadSite({ dir, transport, retryDelayMs: 10, ...extra });
}

const page = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${origin}${path}`, { headers: { "x-site": site, ...headers }, redirect: "manual" });

/** Sends a PUT whose body is cut off after `send` of `declared` bytes, then drops the connection. */
function truncatedPut(path: string, body: Uint8Array, declared: number): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(path, origin);
    const req = httpRequest(url, { method: "PUT", headers: { "content-length": declared } });
    req.on("error", () => resolve());
    req.write(body, () => {
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 100);
    });
  });
}

describe("end to end", () => {
  it("publishes a folder and serves every file byte for byte", async () => {
    const big = randomBytes(20 * 1024 * 1024);
    const files = {
      "index.html": "<h1>home</h1>",
      "about/index.html": "<h1>about</h1>",
      "assets/app-1a2b3c4d.js": "console.log(1)",
      "media/clip.mp4": big,
      "docs/é ü.txt": "unicode",
      "empty.txt": "",
    };
    await write(files);

    const result = await publish({ immutable: (path) => path.startsWith("assets/") });
    expect(readable(result)).toMatchInlineSnapshot(`
      {
        "commit": {
          "alreadyCommitted": false,
          "previous": null,
          "publishId": "p1",
        },
        "phase": "done",
        "toUploadBytes": 20971568,
        "toUploadFiles": 6,
        "totalBytes": 20971568,
        "totalFiles": 6,
        "uploadedBytes": 20971568,
        "uploadedFiles": 6,
      }
    `);

    // A range asked for before any full read, so R2 serves it: nothing is in the edge cache yet.
    const fromR2 = await page("/media/clip.mp4", { range: "bytes=5000-5999" });
    const fromR2Bytes = Buffer.from(await fromR2.arrayBuffer());
    expect({
      status: fromR2.status,
      contentRange: fromR2.headers.get("content-range"),
      sameBytes: fromR2Bytes.equals(big.subarray(5000, 6000)),
    }).toMatchInlineSnapshot(`
      {
        "contentRange": "bytes 5000-5999/20971520",
        "sameBytes": true,
        "status": 206,
      }
    `);

    for (const [path, content] of Object.entries(files)) {
      const res = await page(`/${path.split("/").map(encodeURIComponent).join("/")}`);
      expect(res.status, path).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(content)), path).toBe(true);
    }

    const ranged = await page("/media/clip.mp4", { range: "bytes=1000-1999" });
    expect(Buffer.from(await ranged.arrayBuffer()).equals(big.subarray(1000, 2000))).toBe(true);
    expect({
      status: ranged.status,
      contentRange: ranged.headers.get("content-range"),
      contentLength: ranged.headers.get("content-length"),
    }).toMatchInlineSnapshot(`
      {
        "contentLength": "1000",
        "contentRange": "bytes 1000-1999/20971520",
        "status": 206,
      }
    `);
    expect(await summarize(await page("/assets/app-1a2b3c4d.js"))).toMatchInlineSnapshot(`
      {
        "body": "console.log(1)",
        "headers": {
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=31536000, immutable",
          "content-encoding": "gzip",
          "content-type": "text/javascript; charset=utf-8",
          "etag": ""sha(console.log(1))"",
          "transfer-encoding": "chunked",
          "x-content-type-options": "nosniff",
        },
        "status": 200,
      }
    `);
  });

  it("uploads only what changed; after cleanup, old tabs still load the previous version's chunks", async () => {
    const immutable = (path: string) => path.startsWith("assets/");
    await write({ "index.html": "v1", "assets/app-1.js": "js1", "video.mp4": randomBytes(1024 * 1024) });
    await publish({ immutable });
    await rm(join(dir, "assets/app-1.js"));
    await write({ "index.html": "v2", "assets/app-2.js": "js2" });
    const second = await publish({ immutable });
    await rm(join(dir, "assets/app-2.js"));
    await write({ "index.html": "v3", "assets/app-3.js": "js3" });
    const third = await publish({ immutable });

    const cleanup = async (advanceMs: number) => (await fetch(`${origin}/_cleanup/${site}?advanceMs=${advanceMs}`)).json();
    const status = async (path: string) => (await page(path)).status;
    const summary = {
      second: { uploaded: second.uploadedFiles, commit: second.commit },
      third: { uploaded: third.uploadedFiles, commit: third.commit },
      cleanupNow: await cleanup(0),
      cleanupInTwoHours: await cleanup(2 * 60 * 60 * 1000),
      live: await (await page("/")).text(),
      liveVideoBytes: (await (await page("/video.mp4")).arrayBuffer()).byteLength,
      "previous version's chunk, app-2.js": await status("/assets/app-2.js"),
      "chunk from two versions back, app-1.js": await status("/assets/app-1.js"),
    };
    expect(readable(summary)).toMatchInlineSnapshot(`
      {
        "chunk from two versions back, app-1.js": 404,
        "cleanupInTwoHours": {
          "deletedFiles": 2,
          "deletedPlans": 1,
        },
        "cleanupNow": {
          "deletedFiles": 0,
          "deletedPlans": 0,
        },
        "live": "v3",
        "liveVideoBytes": 1048576,
        "previous version's chunk, app-2.js": 200,
        "second": {
          "commit": {
            "alreadyCommitted": false,
            "previous": "p1",
            "publishId": "p2",
          },
          "uploaded": 2,
        },
        "third": {
          "commit": {
            "alreadyCommitted": false,
            "previous": "p2",
            "publishId": "p3",
          },
          "uploaded": 2,
        },
      }
    `);
  });

  it("refuses a PUT without Content-Length, and one whose bytes don't match", async () => {
    await write({ "index.html": "hello" });
    const base = `${origin}/_upload/${site}/manual`;
    const hash = sha256("hello");
    await fetch(`${base}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, files: { "index.html": { h: hash, s: 5 } } }),
    });

    const chunked = await fetch(`${base}/files/${hash}`, {
      method: "PUT",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    const wrongBytes = await fetch(`${base}/files/${hash}`, { method: "PUT", body: "HELLO" });
    const commit = await fetch(`${base}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    expect({
      chunked: await summarize(chunked),
      wrongBytes: await summarize(wrongBytes),
      commit: await summarize(commit),
    }).toMatchInlineSnapshot(`
      {
        "chunked": {
          "body": {
            "error": {
              "code": "LENGTH_REQUIRED",
              "message": "A Content-Length header is required",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-encoding": "gzip",
            "content-type": "application/json; charset=utf-8",
            "transfer-encoding": "chunked",
          },
          "status": 411,
        },
        "commit": {
          "body": {
            "error": {
              "code": "MISSING_FILES",
              "details": {
                "missing": [
                  "sha(hello)",
                ],
              },
              "message": "1 file is not uploaded yet",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-encoding": "gzip",
            "content-type": "application/json; charset=utf-8",
            "transfer-encoding": "chunked",
          },
          "status": 409,
        },
        "wrongBytes": {
          "body": {
            "error": {
              "code": "HASH_MISMATCH",
              "details": {
                "hash": "sha(hello)",
              },
              "message": "The bytes sent don't hash to sha(hello)",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-encoding": "gzip",
            "content-type": "application/json; charset=utf-8",
            "transfer-encoding": "chunked",
          },
          "status": 400,
        },
      }
    `);
  });

  it("stores nothing when the connection drops mid-file", async () => {
    const content = randomBytes(256 * 1024);
    const hash = sha256(content);
    const base = `/_upload/${site}/manual`;
    await fetch(`${origin}${base}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, files: { "big.bin": { h: hash, s: content.length } } }),
    });

    await truncatedPut(`${base}/files/${hash}`, content.subarray(0, 100 * 1024), content.length);
    // Check storage itself: a re-plan would call a wrong-sized file missing too, so it can't tell.
    const stored = await worker.bucket.list({ prefix: `sites/${site}/f/` });
    expect(readable(stored.objects.map((object) => ({ key: object.key.split("/").at(-1), size: object.size })))).toMatchInlineSnapshot(`[]`);
  });

  it("caches files by hash, then serves them and their ranges without R2", async () => {
    const video = randomBytes(2 * 1024 * 1024);
    await write({ "index.html": "<video>", "clip.mp4": video });
    await publish();
    const hash = sha256(video);
    const isCached = async () =>
      ((await (await fetch(`${origin}/_cached/${hash}`)).json()) as { cached: boolean }).cached;

    const before = await isCached();
    const firstRange = await page("/clip.mp4", { range: "bytes=0-1" });
    await firstRange.arrayBuffer();
    // The miss fills the cache after responding; wait for it.
    let after = false;
    for (let i = 0; i < 50 && !after; i++) {
      after = await isCached();
      if (!after) await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // With the R2 copy gone, only the cache can answer.
    await worker.bucket.delete(`sites/${site}/f/${hash}`);
    const full = await page("/clip.mp4");
    const fullBytes = Buffer.from(await full.arrayBuffer());
    const ranged = await page("/clip.mp4", { range: "bytes=1000-1999" });
    const rangedBytes = Buffer.from(await ranged.arrayBuffer());

    expect({
      cachedBeforeFirstRequest: before,
      cachedAfterFirstRequest: after,
      withoutR2: {
        full: { status: full.status, sameBytes: fullBytes.equals(video) },
        range: {
          status: ranged.status,
          contentRange: ranged.headers.get("content-range"),
          sameBytes: rangedBytes.equals(video.subarray(1000, 2000)),
        },
      },
    }).toMatchInlineSnapshot(`
      {
        "cachedAfterFirstRequest": true,
        "cachedBeforeFirstRequest": false,
        "withoutR2": {
          "full": {
            "sameBytes": true,
            "status": 200,
          },
          "range": {
            "contentRange": "bytes 1000-1999/2097152",
            "sameBytes": true,
            "status": 206,
          },
        },
      }
    `);
  });

  it("serves 404 for a site that doesn't exist", async () => {
    site = "never-published";
    expect(await summarize(await page("/"))).toMatchInlineSnapshot(`
      {
        "body": "Not found",
        "headers": {
          "cache-control": "no-store",
          "content-encoding": "gzip",
          "content-type": "text/plain; charset=utf-8",
          "transfer-encoding": "chunked",
        },
        "status": 404,
      }
    `);
  });
});

import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpTransport, uploadSite } from "../src/client";
import { readable, sha256, summarize, uniqueSite } from "./helpers";

// The server half runs in workerd behind real HTTP; the client runs in Node
// and streams files from disk. Nothing here is mocked.

let mf: Miniflare;
let origin: string;
let dir: string;
let site: string;
let publishCount: number;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: [join(import.meta.dirname, "worker.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
  });
  mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]!.text,
    r2Buckets: ["BUCKET"],
    compatibilityDate: "2025-09-01",
  });
  origin = (await mf.ready).origin;
});
afterAll(() => mf?.dispose());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "site-upload-e2e-"));
  site = uniqueSite("e2e");
  publishCount = 0;
});

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

  it("uploads only what changed, then cleanup keeps the live and previous versions", async () => {
    await write({ "index.html": "v1", "video.mp4": randomBytes(1024 * 1024) });
    await publish();
    await write({ "index.html": "v2" });
    const second = await publish();
    await write({ "index.html": "v3" });
    const third = await publish();

    const cleanup = async (advanceMs: number) => (await fetch(`${origin}/_cleanup/${site}?advanceMs=${advanceMs}`)).json();
    const summary = {
      second: { uploaded: second.uploadedFiles, commit: second.commit },
      third: { uploaded: third.uploadedFiles, commit: third.commit },
      cleanupNow: await cleanup(0),
      cleanupInTwoHours: await cleanup(2 * 60 * 60 * 1000),
      live: await (await page("/")).text(),
      liveVideoBytes: (await (await page("/video.mp4")).arrayBuffer()).byteLength,
    };
    expect(readable(summary)).toMatchInlineSnapshot(`
      {
        "cleanupInTwoHours": {
          "deletedFiles": 1,
          "deletedPlans": 1,
        },
        "cleanupNow": {
          "deletedFiles": 0,
          "deletedPlans": 0,
        },
        "live": "v3",
        "liveVideoBytes": 1048576,
        "second": {
          "commit": {
            "alreadyCommitted": false,
            "previous": "p1",
            "publishId": "p2",
          },
          "uploaded": 1,
        },
        "third": {
          "commit": {
            "alreadyCommitted": false,
            "previous": "p2",
            "publishId": "p3",
          },
          "uploaded": 1,
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
    const commit = await fetch(`${base}/commit`, { method: "POST" });

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
      body: JSON.stringify({ v: 1, files: { "big.bin": { h: hash, s: content.length } } }),
    });

    await truncatedPut(`${base}/files/${hash}`, content.subarray(0, 100 * 1024), content.length);
    const replan = await fetch(`${origin}${base}/plan`, {
      method: "POST",
      body: JSON.stringify({ v: 1, files: { "big.bin": { h: hash, s: content.length } } }),
    });
    expect(readable(await replan.json())).toMatchInlineSnapshot(`
      {
        "missing": [
          "sha(<262144 bytes>)",
        ],
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

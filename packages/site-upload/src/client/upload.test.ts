import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestWorker, readable, sha256, thrown, uniqueSite, type TestWorker } from "../../test/helpers";
import { SiteUploadError, type ErrorCode } from "../protocol/errors";
import { SiteStore } from "../server/store";
import type { UploadTransport } from "./http";
import { uploadSite, withRetry, type UploadProgress, type UploadSiteResult } from "./upload";

let env: TestWorker;
let dir: string;
let site: string;
let store: SiteStore;
let publishCount: number;
/** The live and previous publish, as the server's records keep them. */
let live: string | null;
let previous: string | null;

beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "site-upload-"));
  site = uniqueSite();
  store = new SiteStore({ bucket: env.bucket });
  publishCount = 0;
  live = previous = null;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function write(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
    sha256(content);
  }
}

type Hooks = {
  beforePlan?: () => unknown;
  beforePut?: (hash: string, attempt: number, signal: AbortSignal) => void | Promise<void>;
  beforeCommit?: (attempt: number) => unknown;
};

/** A transport that calls a real SiteStore directly, with hooks to inject faults. */
function storeTransport(hooks: Hooks = {}) {
  const publishId = `p${++publishCount}`;
  const log = {
    plans: 0,
    commits: 0,
    /** Hashes stored, in completion order. */
    puts: [] as string[],
    /** Uploads in flight at the start of each put attempt. */
    starts: [] as number[],
    inFlight: 0,
  };
  const putAttempts = new Map<string, number>();
  const transport: UploadTransport = {
    async plan(manifest) {
      log.plans++;
      await hooks.beforePlan?.();
      return store.plan(site, publishId, JSON.parse(JSON.stringify(manifest)));
    },
    async put(hash, body, signal) {
      const attempt = (putAttempts.get(hash) ?? 0) + 1;
      putAttempts.set(hash, attempt);
      log.inFlight++;
      log.starts.push(log.inFlight);
      try {
        await hooks.beforePut?.(hash, attempt, signal);
        signal.throwIfAborted();
        const bytes = new Uint8Array(await body.arrayBuffer());
        await store.putFile(site, publishId, hash, bytes, bytes.length);
        log.puts.push(hash);
      } finally {
        log.inFlight--;
      }
    },
    async commit() {
      log.commits++;
      await hooks.beforeCommit?.(log.commits);
      // What the server does: check the files, then record the publish as live.
      await store.requireComplete(site, publishId);
      if (live === publishId) return { publishId, previous, alreadyCommitted: true };
      previous = live;
      live = publishId;
      return { publishId, previous, alreadyCommitted: false };
    },
  };
  return { transport, log };
}

/** The parts of a log that don't depend on timing. */
const counts = (log: ReturnType<typeof storeTransport>["log"]) =>
  readable({ plans: log.plans, putAttempts: log.starts.length, stored: [...log.puts].sort(), commits: log.commits });

const fail = (code: ErrorCode, retry: { retryable?: boolean; throttle?: boolean; status?: number } = {}) =>
  new SiteUploadError(code, `injected ${code}`, undefined, retry);

const run = (transport: UploadTransport, extra: Partial<Parameters<typeof uploadSite>[0]> = {}) =>
  uploadSite({ dir, transport, retryDelayMs: 1, ...extra });

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

const manyFiles = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.txt`, `file ${i}`]));

describe("uploadSite", () => {
  it("uploads each unique file once and commits", async () => {
    await write({ "index.html": "home", "a/copy.html": "home", "logo.png": "logo" });
    const { transport, log } = storeTransport();
    const result = await run(transport);
    const manifest = live ? await store.readManifest(site, live) : null;
    expect(readable({ result, log: counts(log), live: manifest?.files })).toMatchInlineSnapshot(`
      {
        "live": {
          "a/copy.html": {
            "h": "sha(home)",
            "s": 4,
          },
          "index.html": {
            "h": "sha(home)",
            "s": 4,
          },
          "logo.png": {
            "h": "sha(logo)",
            "s": 4,
          },
        },
        "log": {
          "commits": 1,
          "plans": 1,
          "putAttempts": 2,
          "stored": [
            "sha(logo)",
            "sha(home)",
          ],
        },
        "result": {
          "commit": {
            "alreadyCommitted": false,
            "previous": null,
            "publishId": "p1",
          },
          "phase": "done",
          "toUploadBytes": 8,
          "toUploadFiles": 2,
          "totalBytes": 12,
          "totalFiles": 3,
          "uploadedBytes": 8,
          "uploadedFiles": 2,
        },
      }
    `);
  });

  it("uploads only changed files on the next publish", async () => {
    await write({ "index.html": "v1", "video.mp4": "big video" });
    await run(storeTransport().transport);
    await write({ "index.html": "v2" });
    const { transport, log } = storeTransport();
    const result: UploadSiteResult = await run(transport);
    expect(readable({ result, log: counts(log) })).toMatchInlineSnapshot(`
      {
        "log": {
          "commits": 1,
          "plans": 1,
          "putAttempts": 1,
          "stored": [
            "sha(v2)",
          ],
        },
        "result": {
          "commit": {
            "alreadyCommitted": false,
            "previous": "p1",
            "publishId": "p2",
          },
          "phase": "done",
          "toUploadBytes": 2,
          "toUploadFiles": 1,
          "totalBytes": 11,
          "totalFiles": 2,
          "uploadedBytes": 2,
          "uploadedFiles": 1,
        },
      }
    `);
  });

  it("commits without uploading when nothing changed", async () => {
    await write({ "index.html": "same" });
    await run(storeTransport().transport);
    const { transport, log } = storeTransport();
    const result = await run(transport);
    expect({ result, log: counts(log) }).toMatchInlineSnapshot(`
      {
        "log": {
          "commits": 1,
          "plans": 1,
          "putAttempts": 0,
          "stored": [],
        },
        "result": {
          "commit": {
            "alreadyCommitted": false,
            "previous": "p1",
            "publishId": "p2",
          },
          "phase": "done",
          "toUploadBytes": 0,
          "toUploadFiles": 0,
          "totalBytes": 4,
          "totalFiles": 1,
          "uploadedBytes": 0,
          "uploadedFiles": 0,
        },
      }
    `);
  });

  it("reports progress in phase order with growing byte counts", async () => {
    await write({ "a.txt": "aaaa", "b.txt": "bb", "c.txt": "c" });
    const events: UploadProgress[] = [];
    await run(storeTransport().transport, { onProgress: (p) => events.push(p), concurrency: 1 });
    // One upload at a time makes the order of uploaded files deterministic.
    expect(events.map((e) => `${e.phase} ${e.uploadedFiles}/${e.toUploadFiles} ${e.uploadedBytes}/${e.toUploadBytes}`))
      .toMatchInlineSnapshot(`
        [
          "hashing 0/0 0/0",
          "planning 0/0 0/0",
          "uploading 0/3 0/7",
          "uploading 1/3 1/7",
          "uploading 2/3 3/7",
          "uploading 3/3 7/7",
          "committing 3/3 7/7",
          "done 3/3 7/7",
        ]
      `);
  });

  describe("retries", () => {
    it("retries retryable upload failures until they succeed", async () => {
      await write({ "index.html": "x" });
      const { transport, log } = storeTransport({
        beforePut: (_, attempt) => {
          if (attempt < 3) throw fail("NETWORK", { retryable: true });
        },
      });
      await run(transport);
      expect(counts(log)).toMatchInlineSnapshot(`
        {
          "commits": 1,
          "plans": 1,
          "putAttempts": 3,
          "stored": [
            "sha(x)",
          ],
        }
      `);
    });

    it("retries plan and commit", async () => {
      await write({ "index.html": "x" });
      const { transport, log } = storeTransport({
        beforePlan: () => {
          if (log.plans === 1) throw fail("HTTP_ERROR", { retryable: true, status: 500 });
        },
        beforeCommit: (attempt) => {
          if (attempt === 1) throw fail("NETWORK", { retryable: true });
        },
      });
      const { commit } = await run(transport);
      expect({ commit, log: counts(log) }).toMatchInlineSnapshot(`
        {
          "commit": {
            "alreadyCommitted": false,
            "previous": null,
            "publishId": "p1",
          },
          "log": {
            "commits": 2,
            "plans": 2,
            "putAttempts": 1,
            "stored": [
              "sha(x)",
            ],
          },
        }
      `);
    });

    it("treats a commit retried after it went through as success", async () => {
      await write({ "index.html": "x" });
      let commits = 0;
      const { transport } = storeTransport();
      const flaky: UploadTransport = {
        ...transport,
        async commit(signal) {
          const result = await transport.commit(signal);
          // The reply to the first commit is lost on the way back.
          if (++commits === 1) throw fail("NETWORK", { retryable: true });
          return result;
        },
      };
      expect((await run(flaky)).commit).toMatchInlineSnapshot(`
        {
          "alreadyCommitted": true,
          "previous": null,
          "publishId": "p1",
        }
      `);
    });

    it("gives up after maxAttempts without committing", async () => {
      await write({ "index.html": "x" });
      const { transport, log } = storeTransport({
        beforePut: () => {
          throw fail("NETWORK", { retryable: true });
        },
      });
      expect({ error: await thrown(run(transport, { maxAttempts: 3 })), log: counts(log) }).toMatchInlineSnapshot(`
        {
          "error": {
            "code": "NETWORK",
            "error": "SiteUploadError",
            "message": "injected NETWORK",
            "retryable": true,
          },
          "log": {
            "commits": 0,
            "plans": 1,
            "putAttempts": 3,
            "stored": [],
          },
        }
      `);
    });

    it("doesn't retry errors that won't change", async () => {
      await write({ "index.html": "x" });
      const { transport, log } = storeTransport({
        beforePut: () => {
          throw fail("NOT_IN_PLAN", { status: 409 });
        },
      });
      expect({ error: await thrown(run(transport)), log: counts(log) }).toMatchInlineSnapshot(`
        {
          "error": {
            "code": "NOT_IN_PLAN",
            "error": "SiteUploadError",
            "message": "injected NOT_IN_PLAN",
            "status": 409,
          },
          "log": {
            "commits": 0,
            "plans": 1,
            "putAttempts": 1,
            "stored": [],
          },
        }
      `);
    });

    it("drops to one upload at a time when the server is overloaded, retry included, then recovers", async () => {
      await write(manyFiles(30));
      let throttledHash: string | null = null;
      // Each upload started after the 503: whether it's the retry, and how many were in flight.
      const startsAfter: string[] = [];
      const { transport, log } = storeTransport({
        beforePut: async (hash, attempt) => {
          if (throttledHash) startsAfter.push(`${hash === throttledHash ? "retry" : "new"} with ${log.inFlight} in flight`);
          await tick();
          if (!throttledHash && attempt === 1) {
            throttledHash = hash;
            throw fail("HTTP_ERROR", { retryable: true, throttle: true, status: 503 });
          }
        },
      });
      await run(transport, { concurrency: 4 });
      expect({
        peakBefore: Math.max(...log.starts.slice(0, 4)),
        firstStartsAfter: startsAfter.slice(0, 3),
        peakAfter: Math.max(...startsAfter.map((start) => Number(start.split(" ")[2]))),
        stored: log.puts.length,
      }).toMatchInlineSnapshot(`
        {
          "firstStartsAfter": [
            "retry with 1 in flight",
            "new with 1 in flight",
            "new with 2 in flight",
          ],
          "peakAfter": 4,
          "peakBefore": 4,
          "stored": 30,
        }
      `);
    });

    it("waits as long as the server's Retry-After", async () => {
      await write({ "index.html": "x" });
      const started = performance.now();
      const { transport } = storeTransport({
        beforePut: (_, attempt) => {
          if (attempt === 1) {
            throw new SiteUploadError("HTTP_ERROR", "busy", undefined, { retryable: true, retryAfterMs: 150 });
          }
        },
      });
      await run(transport, { retryDelayMs: 1 });
      expect(performance.now() - started).toBeGreaterThanOrEqual(140);
    });
  });

  describe("failures", () => {
    it("stops the other uploads when one fails for good", async () => {
      const files = manyFiles(20);
      await write(files);
      // Uploads start in hash order, so the first hash is in the first batch of four.
      const failing = Object.values(files).map(sha256).sort()[0]!;
      let abortedInFlight = 0;
      const { transport, log } = storeTransport({
        beforePut: async (hash, _, signal) => {
          if (hash === failing) {
            await tick();
            throw fail("NOT_IN_PLAN");
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 200);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                abortedInFlight++;
                resolve();
              },
              { once: true },
            );
          });
        },
      });
      const error = await thrown(run(transport, { concurrency: 4 }));
      await tick(20);
      expect({ error, abortedInFlight, log: counts(log) }).toMatchInlineSnapshot(`
        {
          "abortedInFlight": 3,
          "error": {
            "code": "NOT_IN_PLAN",
            "error": "SiteUploadError",
            "message": "injected NOT_IN_PLAN",
          },
          "log": {
            "commits": 0,
            "plans": 1,
            "putAttempts": 4,
            "stored": [],
          },
        }
      `);
    });

    it("stops promptly when the caller aborts", async () => {
      await write(manyFiles(20));
      const controller = new AbortController();
      const { transport, log } = storeTransport({
        beforePut: async (_, __, signal) => {
          if (log.starts.length === 3) controller.abort(new Error("cancelled"));
          await tick(20);
          signal.throwIfAborted();
        },
      });
      const error = await thrown(run(transport, { signal: controller.signal }));
      const startsWhenAborted = log.starts.length;
      await tick(50);
      expect({ error, startsWhenAborted, startsLater: log.starts.length, commits: log.commits }).toMatchInlineSnapshot(`
        {
          "commits": 0,
          "error": {
            "error": "Error",
            "message": "cancelled",
          },
          "startsLater": 3,
          "startsWhenAborted": 3,
        }
      `);
    });

    it("stops during a retry wait when aborted", async () => {
      await write({ "index.html": "x" });
      const controller = new AbortController();
      const { transport } = storeTransport({
        beforePut: () => {
          setTimeout(() => controller.abort(new Error("cancelled")), 10);
          throw fail("NETWORK", { retryable: true });
        },
      });
      const started = performance.now();
      const error = await thrown(run(transport, { signal: controller.signal, retryDelayMs: 10_000 }));
      // The retry wait is 10 s (or Retry-After 10 s); finishing well under it proves the wait was cut short.
      expect(performance.now() - started).toBeLessThan(5000);
      expect(error).toMatchInlineSnapshot(`
        {
          "error": "Error",
          "message": "cancelled",
        }
      `);
    });

    it("rejects, instead of hanging, when onProgress throws mid-upload", async () => {
      await write(manyFiles(6));
      const { transport, log } = storeTransport();
      const outcome = await Promise.race([
        thrown(
          run(transport, {
            onProgress: (p) => {
              if (p.phase === "uploading" && p.uploadedFiles === 2) throw new Error("progress UI crashed");
            },
          }),
        ),
        tick(5000).then(() => "hung"),
      ]);
      expect({ outcome, commits: log.commits }).toMatchInlineSnapshot(`
        {
          "commits": 0,
          "outcome": {
            "error": "Error",
            "message": "progress UI crashed",
          },
        }
      `);
    });

    it("stops when cancelled while every upload is waiting out an overload", async () => {
      await write({ "index.html": "x" });
      const controller = new AbortController();
      const { transport } = storeTransport({
        beforePut: () => {
          setTimeout(() => controller.abort(new Error("cancelled")), 20);
          throw new SiteUploadError("HTTP_ERROR", "busy", undefined, { retryable: true, throttle: true, retryAfterMs: 10_000 });
        },
      });
      const started = performance.now();
      const error = await thrown(run(transport, { signal: controller.signal }));
      // The retry wait is 10 s (or Retry-After 10 s); finishing well under it proves the wait was cut short.
      expect(performance.now() - started).toBeLessThan(5000);
      expect(error).toMatchInlineSnapshot(`
        {
          "error": "Error",
          "message": "cancelled",
        }
      `);
    });

    it("re-plans once if the commit finds files missing", async () => {
      await write({ "index.html": "x" });
      const { transport, log } = storeTransport({
        beforeCommit: async (attempt) => {
          // Cleanup deleted the file between upload and commit.
          if (attempt === 1) await env.bucket.delete(`sites/${site}/f/${sha256("x")}`);
        },
      });
      const result = await run(transport);
      expect(readable({ result, log: counts(log) })).toMatchInlineSnapshot(`
        {
          "log": {
            "commits": 2,
            "plans": 2,
            "putAttempts": 2,
            "stored": [
              "sha(x)",
              "sha(x)",
            ],
          },
          "result": {
            "commit": {
              "alreadyCommitted": false,
              "previous": null,
              "publishId": "p1",
            },
            "phase": "done",
            "toUploadBytes": 2,
            "toUploadFiles": 2,
            "totalBytes": 1,
            "totalFiles": 1,
            "uploadedBytes": 2,
            "uploadedFiles": 2,
          },
        }
      `);
    });

    it("gives up if files are still missing after re-planning", async () => {
      await write({ "index.html": "x" });
      const { transport, log } = storeTransport({
        beforeCommit: () => env.bucket.delete(`sites/${site}/f/${sha256("x")}`),
      });
      expect({ error: await thrown(run(transport)), log: counts(log) }).toMatchInlineSnapshot(`
        {
          "error": {
            "code": "MISSING_FILES",
            "details": {
              "missing": [
                "sha(x)",
              ],
            },
            "error": "SiteUploadError",
            "message": "1 file is not uploaded yet",
          },
          "log": {
            "commits": 2,
            "plans": 2,
            "putAttempts": 2,
            "stored": [
              "sha(x)",
              "sha(x)",
            ],
          },
        }
      `);
    });

    it("refuses a plan that asks for a file the site doesn't have", async () => {
      await write({ "index.html": "x" });
      const transport: UploadTransport = {
        plan: async () => ({ missing: [sha256("something else")] }),
        put: async () => {},
        commit: async () => ({ publishId: "p", previous: null, alreadyCommitted: false }),
      };
      expect(await thrown(run(transport))).toMatchInlineSnapshot(`
        {
          "code": "BAD_RESPONSE",
          "error": "SiteUploadError",
          "message": "The server asked for sha(something else), which isn't in this site",
        }
      `);
    });

    it("reports files that change, grow or vanish after hashing", async () => {
      const outcome = async (change: () => Promise<unknown>) => {
        await write({ "index.html": "aaaa" });
        const { transport, log } = storeTransport({ beforePlan: change });
        const error = await thrown(run(transport));
        return { error: { ...error, message: error.message.replace(dir, "<dir>") }, putAttempts: log.starts.length };
      };
      expect({
        "same size, new bytes": await outcome(() => writeFile(join(dir, "index.html"), "bbbb")),
        "new size": await outcome(() => writeFile(join(dir, "index.html"), "longer")),
        deleted: await outcome(() => rm(join(dir, "index.html"))),
      }).toMatchInlineSnapshot(`
        {
          "deleted": {
            "error": {
              "code": "FILE_CHANGED",
              "details": {
                "path": "index.html",
              },
              "error": "SiteUploadError",
              "message": "index.html can't be read: Unable to open file as blob",
            },
            "putAttempts": 0,
          },
          "new size": {
            "error": {
              "code": "FILE_CHANGED",
              "details": {
                "path": "index.html",
              },
              "error": "SiteUploadError",
              "message": "index.html changed while publishing; publish again",
            },
            "putAttempts": 0,
          },
          "same size, new bytes": {
            "error": {
              "code": "FILE_CHANGED",
              "details": {
                "path": "index.html",
              },
              "error": "SiteUploadError",
              "message": "index.html changed while publishing; publish again",
            },
            "putAttempts": 1,
          },
        }
      `);
    });
  });
});

describe("withRetry", () => {
  const signal = new AbortController().signal;

  it("doubles the delay between attempts", async () => {
    const times: number[] = [];
    await thrown(
      withRetry(
        async () => {
          times.push(performance.now());
          throw fail("NETWORK", { retryable: true });
        },
        { maxAttempts: 4, delayMs: 20, signal },
      ),
    );
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    // 20, 40, 80 ms, each ±25% jitter.
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeGreaterThanOrEqual(14);
    expect(gaps[2]).toBeGreaterThanOrEqual(55);
    expect(gaps[2]!).toBeGreaterThan(gaps[0]!);
  });

  it("doesn't retry errors that aren't SiteUploadErrors", async () => {
    let calls = 0;
    const error = await thrown(
      withRetry(
        async () => {
          calls++;
          throw new TypeError("bug");
        },
        { maxAttempts: 5, delayMs: 1, signal },
      ),
    );
    expect({ error, calls }).toMatchInlineSnapshot(`
      {
        "calls": 1,
        "error": {
          "error": "TypeError",
          "message": "bug",
        },
      }
    `);
  });
});

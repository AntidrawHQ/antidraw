import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { uploadAll, type UploadProgress, type UploadTask } from "../uploader";

type Received = { path: string; headers: IncomingMessage["headers"]; body: Buffer };

let dir: string;
let base: string;
let server: ReturnType<typeof createServer>;
let received: Received[] = [];
let handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

const ok = (_req: IncomingMessage, res: ServerResponse) => res.writeHead(200).end("{}");

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-uploader-"));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      received.push({ path: req.url ?? "", headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  received = [];
  handler = ok;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

const makeTask = async (
  name: string,
  bytes: Buffer,
  headers: Record<string, string> = {},
): Promise<UploadTask> => {
  const file = path.join(dir, name);
  await fs.writeFile(file, bytes);
  return {
    file,
    size: bytes.length,
    url: `${base}/${name}`,
    headers: { "content-length": String(bytes.length), ...headers },
    label: name,
  };
};

describe("uploadAll", () => {
  test("sends the returned headers verbatim, with the file as the body", async () => {
    handler = ok;
    const bytes = Buffer.from("hello, storage");
    const task = await makeTask("verbatim.txt", bytes, {
      "content-type": "text/plain; charset=utf-8",
      "x-amz-checksum-sha256": "c2hhMjU2LWJhc2U2NA==",
      "x-amz-meta-sha256": "ab".repeat(32),
      "cache-control": "public, max-age=31536000, immutable",
    });

    const result = await uploadAll([task]);

    expect(result.isOk()).toBe(true);
    expect(received).toHaveLength(1);
    const [req] = received;
    expect(req!.body.equals(bytes)).toBe(true);
    expect(req!.headers["content-length"]).toBe(String(bytes.length));
    expect(req!.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(req!.headers["x-amz-checksum-sha256"]).toBe("c2hhMjU2LWJhc2U2NA==");
    expect(req!.headers["x-amz-meta-sha256"]).toBe("ab".repeat(32));
    expect(req!.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    // Presigned URLs carry their own auth; no Bearer token may leak here.
    expect(req!.headers.authorization).toBeUndefined();
  });

  test("never runs more than `concurrency` requests at once", async () => {
    let active = 0;
    let peak = 0;
    handler = (_req, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.writeHead(200).end();
      }, 30);
    };
    const tasks = await Promise.all(
      Array.from({ length: 10 }, (_, i) => makeTask(`c${i}.bin`, Buffer.alloc(100, i))),
    );

    const result = await uploadAll(tasks, { concurrency: 3 });

    expect(result.isOk()).toBe(true);
    expect(received).toHaveLength(10);
    expect(peak).toBe(3);
  });

  test("retries 500 and 429, then succeeds", async () => {
    const statuses = [500, 429, 200];
    handler = (_req, res) => res.writeHead(statuses.shift()!).end();
    const task = await makeTask("retry.bin", Buffer.alloc(64, 7));

    const result = await uploadAll([task], { backoffMs: 1 });

    expect(result.isOk()).toBe(true);
    expect(received).toHaveLength(3);
    expect(received.every((r) => r.body.length === 64)).toBe(true);
  });

  test("retries a dropped connection", async () => {
    let first = true;
    handler = (req, res) => {
      if (first) {
        first = false;
        req.socket.destroy();
        return;
      }
      res.writeHead(200).end();
    };
    const task = await makeTask("dropped.bin", Buffer.alloc(32, 1));

    const result = await uploadAll([task], { backoffMs: 1 });

    expect(result.isOk()).toBe(true);
    expect(received).toHaveLength(2);
  });

  test("gives up after `attempts`", async () => {
    handler = (_req, res) => res.writeHead(503).end();
    const task = await makeTask("down.bin", Buffer.alloc(8));

    const result = await uploadAll([task], { attempts: 3, backoffMs: 1 });

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: "UPLOAD_FAILED",
      label: "down.bin",
      status: 503,
    });
    expect(received).toHaveLength(3);
  });

  test("does not retry a 403 (signature or checksum refused)", async () => {
    handler = (_req, res) => res.writeHead(403).end("<Error/>");
    const task = await makeTask("forbidden.bin", Buffer.alloc(16));

    const result = await uploadAll([task], { backoffMs: 1 });

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: "UPLOAD_FAILED",
      status: 403,
      label: "forbidden.bin",
    });
    expect(received).toHaveLength(1);
  });

  test("a failure stops the batch", async () => {
    handler = (req, res) => {
      if (req.url === "/bad.bin") res.writeHead(400).end();
      else setTimeout(() => res.writeHead(200).end(), 20);
    };
    const tasks = [
      await makeTask("bad.bin", Buffer.alloc(4)),
      ...(await Promise.all(
        Array.from({ length: 8 }, (_, i) => makeTask(`after${i}.bin`, Buffer.alloc(4))),
      )),
    ];

    const result = await uploadAll(tasks, { concurrency: 1 });

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "UPLOAD_FAILED", status: 400 });
    expect(received.map((r) => r.path)).toEqual(["/bad.bin"]);
  });

  test("reports byte progress up to the totals, with a final event", async () => {
    handler = ok;
    const sizes = [200_000, 1, 70_000];
    const tasks = await Promise.all(
      sizes.map((size, i) => makeTask(`p${i}.bin`, Buffer.alloc(size, i))),
    );
    const events: UploadProgress[] = [];

    const result = await uploadAll(tasks, { onProgress: (p) => events.push(p) });

    expect(result.isOk()).toBe(true);
    const total = sizes.reduce((a, b) => a + b, 0);
    expect(events.at(-1)).toEqual({
      uploadedBytes: total,
      totalBytes: total,
      uploadedFiles: 3,
      totalFiles: 3,
    });
    for (const e of events) {
      expect(e.uploadedBytes).toBeLessThanOrEqual(total);
      expect(e.totalBytes).toBe(total);
    }
  });

  test("progress does not double-count a retried upload", async () => {
    const statuses = [500, 200];
    handler = (_req, res) => res.writeHead(statuses.shift()!).end();
    const task = await makeTask("recount.bin", Buffer.alloc(1000, 3));
    const events: UploadProgress[] = [];

    await uploadAll([task], { backoffMs: 1, onProgress: (p) => events.push(p) });

    expect(events.at(-1)?.uploadedBytes).toBe(1000);
    expect(Math.max(...events.map((e) => e.uploadedBytes))).toBe(1000);
  });

  test("abort → CANCELLED", async () => {
    handler = () => {
      // never answers
    };
    const task = await makeTask("hang.bin", Buffer.alloc(10));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await uploadAll([task], { signal: controller.signal });

    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
  });

  test("abort during a retry backoff → CANCELLED", async () => {
    handler = (_req, res) => res.writeHead(500).end();
    const task = await makeTask("backoff.bin", Buffer.alloc(10));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await uploadAll([task], {
      signal: controller.signal,
      backoffMs: 60_000,
    });

    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(received).toHaveLength(1);
  });

  test("a missing file fails without retrying", async () => {
    handler = ok;
    const task: UploadTask = {
      file: path.join(dir, "does-not-exist.bin"),
      size: 10,
      url: `${base}/missing`,
      headers: {},
      label: "missing",
    };

    const result = await uploadAll([task], { backoffMs: 1 });

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "UPLOAD_FAILED", label: "missing" });
  });

  test("starts no upload once `startBy` has passed → EXPIRED", async () => {
    handler = ok;
    const task = await makeTask("late.bin", Buffer.alloc(10));

    const result = await uploadAll([task], { startBy: Date.now() - 1, stopBy: Date.now() + 60_000 });

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "EXPIRED", label: "late.bin" });
    expect(received).toHaveLength(0);
  });

  test("does not retry once `startBy` has passed during the backoff", async () => {
    handler = (_req, res) => res.writeHead(500).end();
    const task = await makeTask("late-retry.bin", Buffer.alloc(10));

    const result = await uploadAll([task], {
      startBy: Date.now() + 30,
      backoffMs: 80,
      attempts: 4,
    });

    expect(result._unsafeUnwrapErr().code).toBe("EXPIRED");
    expect(received).toHaveLength(1);
  });

  test("stops an upload still running at `stopBy` → EXPIRED", async () => {
    // Never answers: the PUT would run on past its URL's expiry.
    handler = () => undefined;
    const task = await makeTask("slow.bin", Buffer.alloc(10));
    const started = Date.now();

    const result = await uploadAll([task], { startBy: started + 60_000, stopBy: started + 100 });

    expect(result._unsafeUnwrapErr().code).toBe("EXPIRED");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("uploads normally well before `startBy`", async () => {
    handler = ok;
    const task = await makeTask("in-time.bin", Buffer.alloc(10));
    const now = Date.now();

    const result = await uploadAll([task], { startBy: now + 60_000, stopBy: now + 120_000 });

    expect(result.isOk()).toBe(true);
    expect(received).toHaveLength(1);
  });

  test("nothing to upload is a success", async () => {
    const events: UploadProgress[] = [];
    const result = await uploadAll([], { onProgress: (p) => events.push(p) });
    expect(result.isOk()).toBe(true);
    expect(events.at(-1)).toEqual({ uploadedBytes: 0, totalBytes: 0, uploadedFiles: 0, totalFiles: 0 });
  });
});

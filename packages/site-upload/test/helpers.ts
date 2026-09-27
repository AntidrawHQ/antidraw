import { createHash } from "node:crypto";
import { join } from "node:path";
import { createTestHarness } from "wrangler";
import { SiteUploadError } from "../src/protocol/errors";
import type { Files, Manifest } from "../src/protocol/manifest";
import type { Bucket } from "../src/server/bucket";

// Every hash made here is remembered with its content, so snapshots can show
// sha(<content>) instead of 64 hex characters nobody can review.
const known = new Map<string, string>();

export function sha256(data: string | Uint8Array): string {
  const hash = createHash("sha256").update(data).digest("hex");
  if (typeof data === "string") known.set(hash, data.length > 24 ? `${data.slice(0, 21)}...` : data);
  else if (!known.has(hash)) known.set(hash, `<${data.length} bytes>`);
  return hash;
}

const HASH_ANYWHERE = /[0-9a-f]{64}/g;

/** Deep copy with known hashes replaced by sha(<content>), for snapshots. */
export function readable<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(HASH_ANYWHERE, (hash) => (known.has(hash) ? `sha(${known.get(hash)})` : hash)) as T;
  }
  if (Array.isArray(value)) return value.map(readable) as T;
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [readable(k), readable(v)])) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [readable(k), readable(v)])) as T;
  }
  return value;
}

export type ErrorSummary = {
  error: string;
  code?: string;
  message: string;
  details?: unknown;
  status?: number;
  retryable?: boolean;
  throttle?: boolean;
  retryAfterMs?: number;
};

/** A plain, snapshot-friendly view of an error. */
export function summarizeError(err: unknown): ErrorSummary {
  if (!(err instanceof Error)) return { error: typeof err, message: String(err) };
  if (!(err instanceof SiteUploadError)) return { error: err.name, message: err.message };
  const summary: ErrorSummary = { error: err.name, code: err.code, message: err.message };
  if (err.details !== undefined) summary.details = err.details;
  if (err.status !== undefined) summary.status = err.status;
  if (err.retryable) summary.retryable = true;
  if (err.throttle) summary.throttle = true;
  if (err.retryAfterMs !== undefined) summary.retryAfterMs = err.retryAfterMs;
  return readable(summary);
}

/** Runs `fn` (or awaits a promise) and returns what it threw. Fails if nothing was thrown. */
export async function thrown(work: Promise<unknown> | (() => unknown)): Promise<ErrorSummary> {
  try {
    await (typeof work === "function" ? work() : work);
  } catch (err) {
    return summarizeError(err);
  }
  throw new Error("expected an error, but nothing was thrown");
}

export function thrownSync(fn: () => unknown): ErrorSummary {
  try {
    fn();
  } catch (err) {
    return summarizeError(err);
  }
  throw new Error("expected an error, but nothing was thrown");
}

export type ResponseSummary = { status: number; headers: Record<string, string>; body: unknown };

/** Status, every header, and the body (parsed when JSON), for snapshots. */
export async function summarize(response: Response): Promise<ResponseSummary> {
  const headers: Record<string, string> = {};
  [...response.headers].sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => (headers[k] = v));
  const text = await response.text();
  let body: unknown = text;
  if (headers["content-type"]?.startsWith("application/json")) body = JSON.parse(text);
  return readable({ status: response.status, headers, body });
}

export const bytes = (text: string) => new TextEncoder().encode(text);

/** Builds a manifest from path → content. */
export function manifestOf(contents: Record<string, string>, immutable: string[] = []): Manifest {
  const files: Files = Object.create(null);
  for (const [path, content] of Object.entries(contents)) {
    const entry = { h: sha256(content), s: bytes(content).length };
    files[path] = immutable.includes(path) ? { ...entry, i: true } : entry;
  }
  return { v: 1, files };
}

export type TestWorker = {
  /** The test Worker's URL, served over real HTTP. */
  url: URL;
  /** The Worker's R2 binding, driven from Node. */
  bucket: Bucket;
  close(): Promise<void>;
};

/**
 * Starts test/worker.ts in workerd with a local R2 bucket, using Wrangler's
 * official integration-test harness.
 */
export async function startTestWorker(): Promise<TestWorker> {
  const server = createTestHarness({
    root: join(import.meta.dirname, ".."),
    workers: [
      {
        config: {
          name: "site-upload-test",
          main: "test/worker.ts",
          compatibility_date: "2025-09-01",
          r2_buckets: [{ binding: "BUCKET", bucket_name: "site-upload-test" }],
        },
      },
    ],
  });
  const { url } = await server.listen();
  const env = (await server.getWorker().getEnv()) as { BUCKET: Bucket };
  return { url, bucket: env.BUCKET, close: () => server.close() };
}

let counter = 0;
/** A fresh site key per test, so tests sharing a bucket don't see each other. */
export const uniqueSite = (label = "site") => `${label}-${process.pid}-${++counter}`;

/** Keys under `root`, relative to it, sorted, with hashes made readable. */
export async function keysUnder(bucket: Bucket, root: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: root, cursor, limit: 1000 });
    keys.push(...page.objects.map((object) => object.key.slice(root.length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return readable(keys.sort());
}

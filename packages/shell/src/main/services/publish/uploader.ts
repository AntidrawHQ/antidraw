import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { err, ok, type Result } from "neverthrow";

// PUTs files straight to storage: R2 presigned URLs in prod, the server's
// token-authenticated /api/storage route in dev. Both carry their own auth, so
// this uses plain fetch, never cloudFetch (which would add the Bearer token).
// Headers are sent exactly as the server returned them: in prod they are part
// of the signature, and R2 checks the body against x-amz-checksum-sha256.

export type UploadTask = {
  file: string;
  size: number;
  url: string;
  headers: Record<string, string>;
  label: string; // what the user would recognise: a site path, "snapshot", …
};

export type UploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  uploadedFiles: number;
  totalFiles: number;
};

export type UploadError = {
  // EXPIRED: the session's upload URLs expire too soon (startBy/stopBy).
  code: "UPLOAD_FAILED" | "CANCELLED" | "EXPIRED";
  message: string;
  label?: string;
  status?: number;
};

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS = 1_000;
const PROGRESS_INTERVAL_MS = 250;

// Network errors, 5xx and 429 are worth another try. Any other 4xx is final:
// from R2 a 400 or 403 means the checksum or the signature did not match, and
// sending the same bytes again cannot change that.
const isRetryableStatus = (status: number) => status >= 500 || status === 429;

class AbortedError extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

type Attempt =
  | { kind: "ok" }
  | { kind: "retry"; message: string; status?: number }
  | { kind: "fail"; message: string; status?: number }
  | { kind: "aborted" };

export const uploadAll = async (
  tasks: UploadTask[],
  opts: {
    concurrency?: number;
    attempts?: number;
    backoffMs?: number; // first retry delay, doubled per attempt; tests shorten it
    signal?: AbortSignal;
    // Epoch ms. No attempt (first or retry) starts at or after `startBy`,
    // and any still running at `stopBy` is stopped: both end the batch with
    // EXPIRED. A PUT is checked when it arrives but may stream for as long as
    // the client sends, so one started just before its URL expires can land
    // long after, when the server may no longer track it.
    startBy?: number;
    stopBy?: number;
    onProgress?: (p: UploadProgress) => void;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Result<void, UploadError>> => {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // One controller for the whole batch: the caller's cancel and our own
  // first failure both stop every request still in flight.
  const batch = new AbortController();
  const onOuterAbort = () => batch.abort();
  if (opts.signal?.aborted) batch.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  const progress: UploadProgress = {
    uploadedBytes: 0,
    totalBytes: tasks.reduce((sum, t) => sum + t.size, 0),
    uploadedFiles: 0,
    totalFiles: tasks.length,
  };
  let lastReport = 0;
  const report = (force = false) => {
    if (!opts.onProgress) return;
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    opts.onProgress({ ...progress });
  };

  const attempt = async (task: UploadTask): Promise<Attempt> => {
    // Bytes this attempt has counted, taken back if it has to be retried, so
    // the total never runs past 100%.
    let sent = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sent += chunk.length;
        progress.uploadedBytes += chunk.length;
        report();
        done(null, chunk);
      },
    });
    const source = fs.createReadStream(task.file);
    source.on("error", (e) => counter.destroy(e));
    const body = Readable.toWeb(source.pipe(counter)) as ReadableStream<Uint8Array>;

    try {
      const response = await fetchImpl(task.url, {
        method: "PUT",
        headers: task.headers,
        body,
        // Node's fetch needs this to stream a request body.
        duplex: "half",
        signal: batch.signal,
      } as RequestInit);
      // Drain, so the connection can be reused.
      await response.arrayBuffer().catch(() => undefined);
      if (response.ok) return { kind: "ok" };

      progress.uploadedBytes -= sent;
      const message = `Upload of ${task.label} failed (${response.status})`;
      return isRetryableStatus(response.status)
        ? { kind: "retry", message, status: response.status }
        : { kind: "fail", message, status: response.status };
    } catch (e) {
      progress.uploadedBytes -= sent;
      if (batch.signal.aborted) return { kind: "aborted" };
      // A read error reaches here as fetch's TypeError, with the fs error as
      // its cause.
      const code =
        (e as NodeJS.ErrnoException | undefined)?.code ??
        ((e as { cause?: NodeJS.ErrnoException } | undefined)?.cause?.code);
      // The file is ours (a private staging copy); if it cannot be read,
      // trying again will not help.
      if (code === "ENOENT" || code === "EACCES" || code === "EISDIR") {
        return { kind: "fail", message: `Couldn't read ${task.label}` };
      }
      return {
        kind: "retry",
        message: `Upload of ${task.label} failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    } finally {
      // The server may answer before reading the whole body (a 403 does).
      source.destroy();
    }
  };

  const expired: UploadError = {
    code: "EXPIRED",
    message: "The publish took too long and its uploads expired",
  };
  const tooLate = () => opts.startBy !== undefined && Date.now() >= opts.startBy;

  const uploadOne = async (task: UploadTask): Promise<Result<void, UploadError>> => {
    for (let n = 1; ; n++) {
      if (tooLate()) return err({ ...expired, label: task.label });
      const outcome = await attempt(task);
      if (outcome.kind === "ok") {
        progress.uploadedFiles += 1;
        report();
        return ok(undefined);
      }
      if (outcome.kind === "aborted") {
        return err({ code: "CANCELLED", message: "Publishing was cancelled" });
      }
      if (outcome.kind === "fail" || n >= attempts) {
        return err({
          code: "UPLOAD_FAILED",
          message: outcome.message,
          label: task.label,
          ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        });
      }
      try {
        await sleep(backoffMs * 2 ** (n - 1), batch.signal);
      } catch {
        return err({ code: "CANCELLED", message: "Publishing was cancelled" });
      }
    }
  };

  let next = 0;
  const state: { failure: UploadError | null } = { failure: null };
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  if (opts.stopBy !== undefined && tasks.length > 0) {
    // setTimeout fires at once past 2^31-1 ms; nothing waits that long here.
    const delay = Math.min(Math.max(0, opts.stopBy - Date.now()), 2 ** 31 - 1);
    stopTimer = setTimeout(() => {
      if (!state.failure || state.failure.code === "CANCELLED") state.failure = expired;
      batch.abort();
    }, delay);
    (stopTimer as { unref?: () => void }).unref?.();
  }
  const worker = async () => {
    while (!state.failure && !batch.signal.aborted && next < tasks.length) {
      const task = tasks[next++]!;
      const result = await uploadOne(task);
      if (result.isErr()) {
        // The first real failure is the one to report; the cancellations it
        // causes in the other workers are not.
        // Read again: another worker may have failed during the await.
        const current = state.failure as UploadError | null;
        if (!current || (current.code === "CANCELLED" && result.error.code !== "CANCELLED")) {
          state.failure = result.error;
        }
        batch.abort();
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
    );
  } finally {
    clearTimeout(stopTimer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }

  if (opts.signal?.aborted) {
    return err({ code: "CANCELLED", message: "Publishing was cancelled" });
  }
  if (state.failure) return err(state.failure);
  report(true);
  return ok(undefined);
};

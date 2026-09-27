import { openAsBlob } from "node:fs";
import { SiteUploadError } from "../protocol/errors";
import type { Limits } from "../protocol/limits";
import type { CommitResult } from "../protocol/manifest";
import type { UploadTransport } from "./http";
import { buildManifest, type HashedFile } from "./local";

export type UploadPhase = "hashing" | "planning" | "uploading" | "committing" | "done";

export type UploadProgress = {
  phase: UploadPhase;
  totalFiles: number;
  totalBytes: number;
  /** Files and bytes the server didn't have, known once planning is done. */
  toUploadFiles: number;
  toUploadBytes: number;
  uploadedFiles: number;
  uploadedBytes: number;
};

export type UploadSiteOptions = {
  dir: string;
  transport: UploadTransport;
  limits?: Partial<Limits>;
  immutable?: (path: string) => boolean;
  /** Parallel uploads. Default 4. */
  concurrency?: number;
  /** Tries per request, including the first. Default 5. */
  maxAttempts?: number;
  /** First retry delay, doubled on each retry up to 30 s. Default 1 s. */
  retryDelayMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

export type UploadSiteResult = UploadProgress & { commit: CommitResult };

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Publishes the folder: hash every file, ask the server which it lacks,
 * upload those, then commit. Failed requests are retried with backoff, and a
 * server that reports overload gets one upload at a time until it recovers.
 */
export async function uploadSite(options: UploadSiteOptions): Promise<UploadSiteResult> {
  const signal = options.signal ?? new AbortController().signal;
  const retry = {
    maxAttempts: options.maxAttempts ?? 5,
    delayMs: options.retryDelayMs ?? 1000,
    signal,
  };
  const concurrency = Math.max(1, options.concurrency ?? 4);

  const progress: UploadProgress = {
    phase: "hashing",
    totalFiles: 0,
    totalBytes: 0,
    toUploadFiles: 0,
    toUploadBytes: 0,
    uploadedFiles: 0,
    uploadedBytes: 0,
  };
  const report = (phase: UploadPhase) => {
    progress.phase = phase;
    options.onProgress?.({ ...progress });
  };

  report("hashing");
  const local = await buildManifest(options.dir, {
    limits: options.limits,
    immutable: options.immutable,
    signal,
  });
  progress.totalFiles = Object.keys(local.manifest.files).length;
  progress.totalBytes = local.totalBytes;

  // A commit can find files missing that the plan said were stored, if the
  // server's cleanup ran in between. One more plan and upload round fixes it.
  for (let round = 1; ; round++) {
    report("planning");
    const { missing } = await withRetry(() => options.transport.plan(local.manifest, signal), retry);
    const queue: HashedFile[] = [];
    for (const hash of new Set(missing)) {
      const source = local.sources.get(hash);
      if (!source) {
        throw new SiteUploadError("BAD_RESPONSE", `The server asked for ${hash}, which isn't in this site`);
      }
      queue.push(source);
    }
    progress.toUploadFiles += queue.length;
    progress.toUploadBytes += queue.reduce((sum, file) => sum + file.size, 0);

    report("uploading");
    await uploadAll(queue, concurrency, options.transport, retry, (file) => {
      progress.uploadedFiles++;
      progress.uploadedBytes += file.size;
      report("uploading");
    });

    report("committing");
    try {
      const commit = await withRetry(() => options.transport.commit(signal), retry);
      report("done");
      return { ...progress, commit };
    } catch (err) {
      if (round === 1 && err instanceof SiteUploadError && err.code === "MISSING_FILES") continue;
      throw err;
    }
  }
}

type RetryOptions = {
  maxAttempts: number;
  delayMs: number;
  signal: AbortSignal;
  onThrottle?: () => void;
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    options.signal.throwIfAborted();
    try {
      return await fn();
    } catch (err) {
      if (options.signal.aborted) throw options.signal.reason;
      if (!(err instanceof SiteUploadError) || !err.retryable || attempt >= options.maxAttempts) throw err;
      if (err.throttle) options.onThrottle?.();
      const backoff = Math.min(options.delayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
      await sleep(err.retryAfterMs ?? backoff * (0.75 + Math.random() * 0.5), options.signal);
    }
  }
}

async function uploadAll(
  files: HashedFile[],
  concurrency: number,
  transport: UploadTransport,
  retry: RetryOptions,
  onUploaded: (file: HashedFile) => void,
): Promise<void> {
  if (files.length === 0) return;
  // Stops the other uploads as soon as one fails for good, or the caller aborts.
  const inner = new AbortController();
  const forwardAbort = () => inner.abort(retry.signal.reason);
  retry.signal.addEventListener("abort", forwardAbort, { once: true });

  // On overload, drop to one upload at a time, then add one slot per success.
  // Only uploads started after the latest overload count toward recovering:
  // ones already in flight say nothing about whether the server has recovered.
  let limit = concurrency;
  let generation = 0;
  const fileRetry: RetryOptions = {
    ...retry,
    signal: inner.signal,
    onThrottle: () => {
      generation++;
      limit = 1;
    },
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let next = 0;
      let active = 0;
      let failed = false;
      const pump = () => {
        if (failed) return;
        if (next === files.length && active === 0) return resolve();
        while (active < limit && next < files.length) {
          const file = files[next++]!;
          const startedIn = generation;
          active++;
          uploadOne(file, transport, fileRetry).then(
            () => {
              active--;
              if (startedIn === generation && limit < concurrency) limit++;
              onUploaded(file);
              pump();
            },
            (err) => {
              if (failed) return;
              failed = true;
              inner.abort(err);
              reject(retry.signal.aborted ? retry.signal.reason : err);
            },
          );
        }
      };
      pump();
    });
  } finally {
    retry.signal.removeEventListener("abort", forwardAbort);
  }
}

function uploadOne(file: HashedFile, transport: UploadTransport, retry: RetryOptions): Promise<void> {
  const changed = () =>
    new SiteUploadError("FILE_CHANGED", `${file.path} changed while publishing; publish again`, {
      path: file.path,
    });
  return withRetry(async () => {
    // A Blob backed by the file streams from disk, and fetch sends its size
    // as Content-Length. Node fails the read if the file changes underneath.
    let blob: Blob;
    try {
      // Throws synchronously when the file is gone, so it's awaited inside try.
      blob = await openAsBlob(file.absPath);
    } catch (err) {
      throw new SiteUploadError(
        "FILE_CHANGED",
        `${file.path} can't be read: ${err instanceof Error ? err.message : String(err)}`,
        { path: file.path },
      );
    }
    if (blob.size !== file.size) throw changed();
    // Opening the file is async; an abort that landed meanwhile must stop the upload here.
    retry.signal.throwIfAborted();
    try {
      await transport.put(file.hash, blob, retry.signal);
    } catch (err) {
      if (err instanceof SiteUploadError && err.code === "HASH_MISMATCH") throw changed();
      throw err;
    }
  }, retry);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

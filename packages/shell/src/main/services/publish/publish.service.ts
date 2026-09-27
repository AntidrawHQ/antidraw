import fs from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { getWorkspace } from "@/main/api/services/workspace.service";
import { getAccount, type AccountError } from "@/main/services/account.service";
import {
  LARGE_FILE_BYTES,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_UNCOMPRESSED_BYTES,
  largestFiles,
  packSnapshot,
  scanWorkspace,
  stageSnapshot,
  type ExclusionReport,
  type PackedSnapshot,
  type SnapshotError,
  type SnapshotManifest,
  type SnapshotPlan,
  type StagedSnapshot,
} from "@/main/lib/snapshot";
import {
  buildWorkspaceSite,
  type BuiltSite,
  type SiteBuildError,
} from "./site-builder";
import {
  abortPublish,
  beginPublish,
  completePublish,
  fetchSiteStatus,
  getPublishSession,
  patchSite,
  type BeginPublishRequest,
  type CloudError,
  type PublishSessionResponse,
} from "./cloud-publish";
import { ABORTED, cloudTiming, untilAborted } from "./deadline";
import { uploadAll, type UploadError, type UploadTask } from "./uploader";
import { watchWorkspaceActivity, type ActivityWatch } from "./workspace-busy";
import { createStagingDir, sweepStaleStaging } from "./staging";
import {
  MAX_LARGE_FILES,
  MAX_SITE_BYTES,
  MAX_SITE_FILES,
  type PublishError,
  type PublishErrorDetails,
  type PublishEvent,
  type PublishNote,
  type PublishResult,
  type SiteStatus,
} from "./types";

// Publishes a workspace (spec §1.1): scan → stage → pack the snapshot, build
// the site from the same staged tree, then begin → upload → complete against
// the server. Progress goes out as PublishEvents; every failure, thrown or
// not, ends the stream as one `error` event — the generator never throws.

// The entry pages every built site has. They are ordinary site files.
const ENTRY_FILES = ["preview.html", "canvas.json", "index.html"] as const;

const COMPLETE_ATTEMPTS = 5;

// Complete's retry backoff is base·2^(n-1) (2, 4, 8, 16 s). Tests shorten it.
// followDelaysMs: the waits between main's own background retries of a
// publish left unfinished (see followUnfinished), the last one repeating; an
// empty list turns them off (tests do, except where they test them).
export const publishTiming = {
  completeRetryBaseMs: 2_000,
  followDelaysMs: [15_000, 30_000, 60_000, 120_000] as number[],
};

// ============================================================================
// Errors
// ============================================================================

const publishError = (
  code: PublishError["code"],
  message: string,
  details?: PublishErrorDetails,
): PublishError => (details ? { code, message, details } : { code, message });

const CANCELLED = publishError("CANCELLED", "Publishing was cancelled.");
const SIGNED_OUT = publishError("SIGNED_OUT", "Sign in to publish.");
// A session that committed while its site has not been switched over to the
// new version yet (spec §11.3): visitors still get the previous one.
const NOT_LIVE_YET =
  "The publish was saved, but the site hasn't switched over to it yet. Check again in a moment.";
const WORKSPACE_BUSY = publishError(
  "WORKSPACE_BUSY",
  "Claude is still working. Publish when the turn finishes.",
);

const unexpected = (e: unknown): PublishError =>
  publishError(
    "INTERNAL_ERROR",
    `Publishing failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`,
  );

const fromAccountError = (e: AccountError): PublishError =>
  e.code === "SIGNED_OUT" || e.code === "SERVER_UNREACHABLE"
    ? publishError(e.code, e.message)
    : publishError("SERVER_ERROR", e.message);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const pickNumbers = <K extends keyof PublishErrorDetails>(
  source: Record<string, unknown>,
  keys: readonly K[],
): Pick<PublishErrorDetails, K> => {
  const out: Partial<PublishErrorDetails> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") (out as Record<string, number>)[key] = value;
  }
  return out as Pick<PublishErrorDetails, K>;
};

const stringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;

// Server codes that mean the app and server disagree about the contract.
// Nothing the user does fixes them, so they are INTERNAL_ERROR, naming the
// server's code.
const CONTRACT_CODES = new Set([
  "INVALID_REQUEST",
  "REMIX_DISABLED",
  "PUBLISH_NOT_FOUND",
  "SITE_NOT_FOUND",
]);

// Server (A) errors, spec §5.4. `manifest` adds largestFiles to the size and
// quota refusals, which only the app can list.
export const mapCloudError = (
  e: CloudError,
  manifest?: SnapshotManifest,
): PublishError => {
  const details = isRecord(e.details) ? e.details : {};
  const largest = manifest ? { largestFiles: largestFiles(manifest) } : {};

  switch (e.code) {
    case "SIGNED_OUT":
    case "SERVER_UNREACHABLE":
      return publishError(e.code, e.message);
    case "CANCELLED":
      return CANCELLED;
    case "PUBLISH_TOO_LARGE":
      return publishError(
        "PUBLISH_TOO_LARGE",
        "This canvas is too large to publish.",
        { ...pickNumbers(details, ["limitBytes", "snapshotBytes"]), ...largest },
      );
    case "SITE_TOO_LARGE":
      return publishError(
        "SITE_TOO_LARGE",
        "The built site is too large to publish.",
        {
          ...pickNumbers(details, ["limitBytes", "siteBytes", "siteFileCount"]),
          ...largest,
        },
      );
    case "QUOTA_EXCEEDED":
      // "pending-site": not the storage quota, but the site files of this
      // account's unfinished publishes, which stop counting when those
      // sessions finish or expire (up to two hours).
      if (details.reason === "pending-site") {
        return publishError(
          "QUOTA_EXCEEDED",
          "Too many site files are waiting on unfinished publishes. Try again in an hour or two.",
          {
            reason: "pending-site",
            ...pickNumbers(details, ["quotaBytes", "usedBytes", "publishBytes"]),
          },
        );
      }
      // The account's published sites, apart from the storage quota: all
      // their contents GC has not removed ("site-storage"), and the files
      // their retained versions list ("site-files").
      if (details.reason === "site-storage" || details.reason === "site-files") {
        return publishError(
          "QUOTA_EXCEEDED",
          details.reason === "site-storage"
            ? "Your published sites use all the storage they are allowed."
            : "Your published sites have too many files between them.",
          {
            reason: details.reason,
            ...pickNumbers(details, ["quotaBytes", "usedBytes", "publishBytes"]),
          },
        );
      }
      return publishError(
        "QUOTA_EXCEEDED",
        "Publishing this would go over your storage quota.",
        {
          ...pickNumbers(details, ["quotaBytes", "usedBytes", "publishBytes"]),
          ...largest,
        },
      );
    case "SITE_LIMIT": {
      const limit = typeof details.limit === "number" ? details.limit : undefined;
      return publishError(
        "SITE_LIMIT",
        limit !== undefined
          ? `You have reached the limit of ${limit} published canvases.`
          : "You have reached the limit of published canvases.",
        limit !== undefined ? { siteLimit: limit } : undefined,
      );
    }
    case "INVALID_PATH": {
      const paths = stringArray(details.paths);
      return publishError(
        "SNAPSHOT_FAILED",
        "Some file names can't be published.",
        paths ? { paths } : undefined,
      );
    }
    case "UPLOAD_INCOMPLETE":
      return publishError(
        "UPLOAD_FAILED",
        "Some uploads did not arrive. Publish again.",
      );
    case "PUBLISH_CONFLICT":
      return publishError(
        "PUBLISH_CONFLICT",
        "This canvas was published from somewhere else while this publish ran. Publish again.",
      );
    case "PUBLISH_IN_PROGRESS":
      return publishError(
        "PUBLISH_IN_PROGRESS",
        "Another publish of this canvas is still finishing. Try again in a moment.",
      );
    case "PUBLISH_EXPIRED":
      return publishError(
        "PUBLISH_EXPIRED",
        "The publish took too long and expired. Publish again.",
      );
    case "RATE_LIMITED":
      // "open-sessions": too many unfinished publishes hold their sessions;
      // they free up as they finish or expire (up to two hours), not within
      // the minute the plain rate limit resets in.
      if (details.reason === "open-sessions") {
        return publishError(
          "RATE_LIMITED",
          "Too many unfinished publishes. Try again in an hour or two.",
          { reason: "open-sessions" },
        );
      }
      return publishError(
        "RATE_LIMITED",
        "Too many publishes in a short time. Wait a minute and try again.",
      );
  }

  if (CONTRACT_CODES.has(e.code)) {
    return publishError(
      "INTERNAL_ERROR",
      `The server refused the publish (${e.code}): ${e.message}`,
      { serverCode: e.code },
    );
  }
  // SLUG_ALLOCATION_FAILED, STORAGE_MISCONFIGURED, CONFIG_INVALID,
  // STORAGE_FAILED, PUBLISH_STORE_FAILED, INTERNAL_ERROR, any other 5xx and
  // anything unrecognised.
  return publishError(
    "SERVER_ERROR",
    "The AntiDraw server had a problem. Try again in a moment.",
    { serverCode: e.code },
  );
};

// Snapshot (B) errors.
export const mapSnapshotError = (e: SnapshotError): PublishError => {
  switch (e.code) {
    case "CASE_COLLISION": {
      const groups = Array.isArray(e.paths)
        ? e.paths.filter((g): g is string[] => Array.isArray(g))
        : [];
      return publishError(
        "CASE_COLLISION",
        "Some files differ only in upper/lower case, which a published canvas can't hold. Rename them and publish again.",
        { collisions: groups },
      );
    }
    case "SOURCE_MISSING":
      return publishError("WORKSPACE_NOT_FOUND", e.message);
    case "SCAN_FAILED":
    case "STAGE_FAILED":
    case "PACK_FAILED": {
      const paths = stringArray(e.paths);
      return publishError(
        "SNAPSHOT_FAILED",
        e.message,
        paths ? { paths } : undefined,
      );
    }
    case "TOO_LARGE":
      // Files grew past the limit between the scan and the copy.
      return publishError(
        "PUBLISH_TOO_LARGE",
        "This canvas's files add up to more than can be published.",
        { limitBytes: MAX_SNAPSHOT_BYTES },
      );
    case "CANCELLED":
      return CANCELLED;
    default:
      return e.code satisfies never;
  }
};

// Site build (C) errors.
export const mapSiteBuildError = (e: SiteBuildError): PublishError => {
  const logTail = e.logTail ? { logTail: e.logTail } : {};
  switch (e.code) {
    case "DEPENDENCIES_MISSING":
      return publishError("DEPENDENCIES_MISSING", e.message);
    case "BUILD_FAILED":
    case "RESOURCES_MISSING":
    case "SITE_ASSEMBLY_FAILED":
      return publishError("BUILD_FAILED", e.message, logTail);
    case "BUILD_TIMEOUT":
      return publishError(
        "BUILD_FAILED",
        "The build took too long and was stopped.",
        { ...logTail, timedOut: true },
      );
    case "CANCELLED":
      return CANCELLED;
    default:
      return e.code satisfies never;
  }
};

const fromUploadError = (e: UploadError): PublishError =>
  e.code === "CANCELLED" ? CANCELLED : publishError("UPLOAD_FAILED", e.message);

// Complete is idempotent (a completed session answers with its result), so
// anything that leaves its outcome unknown is worth another try.
// RATE_LIMITED: the server refused before touching the session, so waiting
// and asking again is safe.
const isRetryableComplete = (e: CloudError) =>
  e.code === "SERVER_UNREACHABLE" ||
  (e.status >= 500 && e.code !== "SIGNED_OUT") ||
  (e.status === 409 && e.code === "PUBLISH_IN_PROGRESS") ||
  (e.status === 429 && e.code === "RATE_LIMITED");

// ============================================================================
// Runs
// ============================================================================

type Run = {
  controller: AbortController;
  // From `finishing` on, the server may already have committed: cancel no
  // longer aborts the run and abort is never sent.
  finishing: boolean;
  staging: string | null;
};

// One run per workspace; a second gets PUBLISH_IN_PROGRESS.
const runs = new Map<string, Run>();

// A run that ended PUBLISH_OUTCOME_UNKNOWN with its session still pending,
// unreadable, or committed but not yet live, one per workspace: what
// getPublishOutcome needs to send complete again, which main also does on its
// own (followUnfinished) until the record is dropped. The run's staging is
// gone by then, but complete needs only the session: everything was uploaded.
// Dropped once complete answers (live, or refused for good), when the server
// reports the session aborted or expired, when it is aborted, when a new run
// of the workspace has begun its own session (not when it starts: one that
// ends before begin answers leaves it be), or once it has expired. Its retry
// and a run of the same workspace never overlap: a run waits for a retry in
// flight before it begins (else the old session could commit after the new
// one's begin and fail its complete as a conflict), and no retry starts while
// a run holds the workspace.
type Unfinished = {
  publishId: string;
  expiresAt: number;
  // The publish's distinct objects, which complete's time limit scales with.
  objects: number;
  // The server's definite refusal of complete; only the abort is left to do.
  refused?: CloudError;
  inFlight?: Promise<Result<PublishSessionResponse, PublishError>> | null;
  // main's next background retry (followUnfinished).
  follow?: ReturnType<typeof setTimeout> | null;
};
const unfinished = new Map<string, Unfinished>();
// A retry in flight, per workspace, until it settles: every run that starts
// meanwhile waits for it before it begins, a cancelled one included (it must
// not leave the next one free to begin under it).
const retries = new Map<string, Promise<unknown>>();

// The sessions this process began (the newest BEGUN_KEPT), by publishId: when
// each expires, and whether this process ever saw it committed. A session the
// server answers 404 about is told apart by these (see goneOutcome): the
// server forgets a session that never committed a day after it expired, and a
// committed one only after a week, and answers 404 for another account's
// session too, so the 404 alone says nothing about whether it went live.
// Kept apart from `unfinished`, which drops its record before every ask about
// the session has come in.
type Begun = { expiresAt: number; committed: boolean };
const BEGUN_KEPT = 100;
const begunSessions = new Map<string, Begun>();

const rememberBegun = (publishId: string, expiresAt: number) => {
  begunSessions.delete(publishId);
  begunSessions.set(publishId, { expiresAt, committed: false });
  for (const oldest of begunSessions.keys()) {
    if (begunSessions.size <= BEGUN_KEPT) break;
    begunSessions.delete(oldest);
  }
};

const markCommitted = (publishId: string) => {
  const begun = begunSessions.get(publishId);
  if (begun) begun.committed = true;
};

const forgetUnfinished = (workspaceId: string) => {
  const held = unfinished.get(workspaceId);
  if (!held) return;
  if (held.follow) clearTimeout(held.follow);
  held.follow = null;
  unfinished.delete(workspaceId);
};

const keepUnfinished = (workspaceId: string, held: Unfinished) => {
  const now = Date.now();
  for (const [id, other] of unfinished) {
    if (other.expiresAt < now) forgetUnfinished(id);
  }
  forgetUnfinished(workspaceId);
  unfinished.set(workspaceId, held);
  followUnfinished(workspaceId, held, 0);
};

// Only while it is still the workspace's record: a retry that settles late
// must not drop what a newer run left.
const dropUnfinished = (workspaceId: string, held: Unfinished) => {
  if (unfinished.get(workspaceId) === held) forgetUnfinished(workspaceId);
};

// main's own retries of a publish left unfinished, so it finishes (or is let
// go) whether or not anything asks: the renderer's "Check status" and its
// follow-up survive a closed panel but not a reload or a closed window. Each
// is getPublishOutcome, which already keeps to one attempt at a time and
// stays out of a run's way. They stop once the record is dropped (a final
// answer, or a new run of the workspace has begun its own session) or the
// session has expired. While a run holds the workspace they only read, and
// carry on once it ends without beginning.
const followUnfinished = (workspaceId: string, held: Unfinished, attempt: number) => {
  const delays = publishTiming.followDelaysMs;
  if (delays.length === 0) return;
  const delay = delays[Math.min(attempt, delays.length - 1)]!;
  if (Date.now() + delay > held.expiresAt) return;
  const timer = setTimeout(() => {
    if (unfinished.get(workspaceId) !== held || held.follow !== timer) return;
    held.follow = null;
    void getPublishOutcome(workspaceId, held.publishId)
      .catch(() => undefined)
      .finally(() => {
        if (unfinished.get(workspaceId) === held && !held.follow) {
          followUnfinished(workspaceId, held, attempt + 1);
        }
      });
  }, delay);
  // Never what keeps the process up.
  (timer as { unref?: () => void }).unref?.();
  held.follow = timer;
};

export const cancelPublish = (workspaceId: string): boolean => {
  const run = runs.get(workspaceId);
  if (!run || run.finishing) return false;
  run.controller.abort();
  return true;
};

// Events are produced by callbacks (build log, upload progress) as well as
// between steps, so the run pushes into a queue the generator drains.
const createChannel = <T>() => {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push: (value: T) => {
      buffer.push(value);
      notify();
    },
    close: () => {
      closed = true;
      notify();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
};

// allowRemix is sent to begin only when present (the user changed it);
// otherwise the site keeps its setting.
export async function* publishWorkspace(
  workspaceId: string,
  opts: { allowRemix?: boolean; signal: AbortSignal },
): AsyncGenerator<PublishEvent> {
  // Claimed before the first yield, so two runs started together cannot both
  // get past it.
  if (runs.has(workspaceId)) {
    yield { type: "step", step: "checking" };
    yield {
      type: "error",
      error: publishError(
        "PUBLISH_IN_PROGRESS",
        "This canvas is already being published.",
      ),
    };
    return;
  }
  const run: Run = {
    controller: new AbortController(),
    finishing: false,
    staging: null,
  };
  runs.set(workspaceId, run);
  // A "check status" retry of an earlier unfinished publish still in flight:
  // the run waits for it before it begins. The earlier record itself is kept
  // until the run has begun its own session (see steps).
  const retrying = retries.get(workspaceId) ?? null;

  const onCallerAbort = () => {
    if (!run.finishing) run.controller.abort();
  };
  if (opts.signal.aborted) onCallerAbort();
  else opts.signal.addEventListener("abort", onCallerAbort, { once: true });

  const channel = createChannel<PublishEvent>();
  const task = execute(workspaceId, opts.allowRemix, run, retrying, channel.push)
    .catch((e: unknown) => err(unexpected(e)))
    .then((outcome) =>
      channel.push(
        outcome.isOk()
          ? { type: "done", result: outcome.value }
          : { type: "error", error: outcome.error },
      ),
    )
    .finally(() => {
      opts.signal.removeEventListener("abort", onCallerAbort);
      runs.delete(workspaceId);
      channel.close();
    });

  yield* channel.drain();
  await task;
}

type RunState = {
  staging: string | null;
  session: string | null; // begun and not yet handed to complete
};

const execute = async (
  workspaceId: string,
  allowRemix: boolean | undefined,
  run: Run,
  retrying: Promise<unknown> | null,
  emit: (event: PublishEvent) => void,
): Promise<Result<PublishResult, PublishError>> => {
  emit({ type: "step", step: "checking" });

  // Bounded by complete's own time limit (plus an abort and a read).
  if (retrying) {
    const settled = await untilAborted(
      retrying.catch(() => undefined),
      run.controller.signal,
    );
    if (settled === ABORTED) return err(CANCELLED);
  }

  // getAccount takes no signal: stop waiting on a cancel or after the same
  // bound the publish API's requests get.
  const accountTimeout = AbortSignal.timeout(cloudTiming.requestTimeoutMs);
  const account = await untilAborted(
    getAccount(),
    AbortSignal.any([run.controller.signal, accountTimeout]),
  );
  if (account === ABORTED) {
    return err(
      run.controller.signal.aborted
        ? CANCELLED
        : publishError(
            "SERVER_UNREACHABLE",
            "The AntiDraw server took too long to answer.",
          ),
    );
  }
  if (account.isErr()) return err(fromAccountError(account.error));
  if (!account.value) return err(SIGNED_OUT);

  const workspace = await getWorkspace(workspaceId);
  if (workspace.isErr()) {
    return err(
      workspace.error.status === 404
        ? publishError("WORKSPACE_NOT_FOUND", "This canvas no longer exists.")
        : publishError("INTERNAL_ERROR", workspace.error.message),
    );
  }

  const state: RunState = { staging: null, session: null };
  const watch = watchWorkspaceActivity(workspaceId);

  let outcome: Result<PublishResult, PublishError>;
  try {
    outcome = await steps({
      workspaceId,
      workspaceName: workspace.value.name,
      allowRemix,
      run,
      state,
      watch,
      emit,
    });
  } catch (e) {
    outcome = err(unexpected(e));
  } finally {
    watch.stop();
    if (state.staging) {
      await fs
        .rm(state.staging, { recursive: true, force: true })
        .catch((e: unknown) =>
          console.error(`Couldn't remove publish staging ${state.staging}:`, e),
        );
    }
  }

  // Nothing a visitor sees changes before complete commits (the site switches
  // over in one pointer write after it), so a failed or cancelled run leaves
  // the live site as it was; only the session is left to end.
  if (outcome.isErr() && state.session) {
    // Best effort: the server expires the session anyway.
    const session = state.session;
    void abortPublish(session).then((r) => {
      if (r.isErr()) console.error(`Couldn't abort publish ${session}:`, r.error);
    });
  }
  return outcome;
};

const ensureIdle = async (
  watch: ActivityWatch,
): Promise<Result<void, PublishError>> => {
  const busy = await watch.busyNow();
  if (busy.isErr()) return err(publishError("INTERNAL_ERROR", busy.error.message));
  // busyNow() settles the watch's lookups, so dirty() is current here.
  if (busy.value || watch.dirty()) return err(WORKSPACE_BUSY);
  return ok(undefined);
};

// .env* files are never snapshotted, so the build did not see them either.
const notesFor = (excluded: ExclusionReport): PublishNote[] => {
  const envPaths = excluded.listed
    .filter((x) => x.reason === "always-excluded")
    .map((x) => x.path)
    .filter((p) => /^\.env/i.test(path.posix.basename(p.replace(/\/$/, ""))));
  return envPaths.length > 0
    ? [
        {
          code: "ENV_FILES_EXCLUDED",
          message:
            "Environment files (.env) are never published, and the site was built without them, so their VITE_ values are not in the published site.",
          paths: envPaths,
        },
      ]
    : [];
};

const sumSizes = (files: readonly { size: number }[]) =>
  files.reduce((sum, f) => sum + f.size, 0);

// The pre-checks mirror the server's limits, so an oversized publish is
// refused before anything is uploaded. `snapshotBytes` (archive + distinct
// blobs) is known only after packing; everything else is decided by sizes and
// counts, which the scan plan already has.
const snapshotLimitsError = (totals: {
  uncompressedBytes: number;
  fileCount: number;
  largeFileCount: number;
  snapshotBytes?: number;
  largest: () => { path: string; size: number }[];
}): PublishError | null => {
  const { uncompressedBytes, fileCount, largeFileCount, snapshotBytes } = totals;
  const reason =
    snapshotBytes !== undefined && snapshotBytes > MAX_SNAPSHOT_BYTES
      ? "This canvas is too large to publish."
      : uncompressedBytes > MAX_UNCOMPRESSED_BYTES
        ? "This canvas's files add up to more than can be published."
        : fileCount > MAX_SNAPSHOT_FILES
          ? "This canvas has more files than can be published."
          : largeFileCount > MAX_LARGE_FILES
            ? "This canvas has more large files than can be published."
            : null;
  if (!reason) return null;
  return publishError("PUBLISH_TOO_LARGE", reason, {
    largestFiles: totals.largest(),
    limitBytes: MAX_SNAPSHOT_BYTES,
    ...(snapshotBytes !== undefined ? { snapshotBytes } : {}),
    uncompressedBytes,
    fileCount,
    largeFileCount,
  });
};

// Before staging: a canvas over the limits is refused without copying,
// hashing or packing any of it. Scan-time sizes; stage decides blob storage
// by the same LARGE_FILE_BYTES threshold.
const checkPlanLimits = (plan: SnapshotPlan): Result<void, PublishError> => {
  const error = snapshotLimitsError({
    uncompressedBytes: sumSizes(plan.files),
    fileCount: plan.files.length,
    largeFileCount: plan.files.filter((f) => f.size >= LARGE_FILE_BYTES).length,
    largest: () => largestFiles(plan),
  });
  return error ? err(error) : ok(undefined);
};

// After packing: the staged sizes (files may have grown since the scan) and
// the packed size.
const checkSnapshotLimits = (
  packed: PackedSnapshot,
): Result<void, PublishError> => {
  const error = snapshotLimitsError({
    uncompressedBytes: packed.uncompressedBytes,
    fileCount: packed.fileCount,
    largeFileCount: packed.manifest.files.filter((f) => f.storage === "blob").length,
    snapshotBytes: packed.snapshotBytes,
    largest: () => largestFiles(packed.manifest),
  });
  return error ? err(error) : ok(undefined);
};

// Every file the site serves: the entry pages are ordinary site files,
// declared and uploaded like the rest.
const siteFilesOf = (built: BuiltSite) => [...built.files, ...built.entries];

const checkSiteLimits = (built: BuiltSite): Result<void, PublishError> => {
  const files = siteFilesOf(built);
  const siteBytes = sumSizes(files);
  if (files.length <= MAX_SITE_FILES && siteBytes <= MAX_SITE_BYTES) {
    return ok(undefined);
  }
  return err(
    publishError("SITE_TOO_LARGE", "The built site is too large to publish.", {
      siteFileCount: files.length,
      siteBytes,
      limitBytes: MAX_SITE_BYTES,
    }),
  );
};

const beginRequest = (opts: {
  workspaceId: string;
  workspaceName: string;
  allowRemix: boolean | undefined;
  packed: PackedSnapshot;
  built: BuiltSite;
}): Result<BeginPublishRequest, PublishError> => {
  const { packed, built } = opts;
  const files = siteFilesOf(built);
  const paths = new Set(files.map((f) => f.path));
  if (ENTRY_FILES.some((name) => !paths.has(name))) {
    return err(
      publishError("BUILD_FAILED", "The built site is missing its entry pages."),
    );
  }
  // The server takes 1-100 characters (zod counts UTF-16 code units); the name
  // is only the slug base and the remix display name. Cut whole code points so
  // a surrogate pair is never split.
  let cut = "";
  for (const ch of opts.workspaceName.trim()) {
    if (cut.length + ch.length > 100) break;
    cut += ch;
  }
  const name = cut.trim() || "Canvas";

  return ok({
    clientWorkspaceId: opts.workspaceId,
    name,
    ...(opts.allowRemix !== undefined ? { allowRemix: opts.allowRemix } : {}),
    snapshot: {
      source: { sha256: packed.archiveSha256, size: packed.archiveSize },
      largeFiles: packed.manifest.files
        .filter((f) => f.storage === "blob")
        .map(({ path, sha256, size, mode }) => ({ path, sha256, size, mode })),
      fileCount: packed.fileCount,
      uncompressedBytes: packed.uncompressedBytes,
    },
    site: {
      files: files.map(({ path, sha256, size, contentType, immutable }) => ({
        path,
        sha256,
        size,
        contentType,
        immutable,
      })),
    },
  });
};

// The distinct objects a plan names (its source, blobs and site contents):
// what complete may HEAD-check before it commits.
const planObjectCount = (plan: BeginPublishRequest): number =>
  1 +
  new Set(plan.snapshot.largeFiles.map((f) => f.sha256)).size +
  new Set(plan.site.files.map((f) => f.sha256)).size;

// Upload instructions → local files. Only what this publish planned is
// uploaded: an instruction for anything else is a contract bug. Site files
// are stored by content, so a site instruction names a sha256; any planned
// file with that content will do (its `path`, when given, is preferred as the
// label). Each object is uploaded once, even if the server lists it twice.
const uploadTasks = (
  uploads: { kind: "source" | "blob" | "site"; sha256: string; path?: string; url: string; headers: Record<string, string> }[],
  packed: PackedSnapshot,
  built: BuiltSite,
): Result<UploadTask[], PublishError> => {
  const blobs = new Map(packed.blobs.map((b) => [b.sha256, b]));
  const siteFiles = siteFilesOf(built);
  const byPath = new Map(siteFiles.map((f) => [f.path, f]));
  // Reversed, so the first file with a given content wins.
  const byContent = new Map([...siteFiles].reverse().map((f) => [f.sha256, f]));
  const seen = new Set<string>();
  const tasks: UploadTask[] = [];
  for (const u of uploads) {
    const key = `${u.kind}:${u.sha256}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = { url: u.url, headers: u.headers };
    if (u.kind === "source" && u.sha256 === packed.archiveSha256) {
      tasks.push({ ...base, file: packed.archiveFile, size: packed.archiveSize, label: "the snapshot" });
      continue;
    }
    const blob = u.kind === "blob" ? blobs.get(u.sha256) : undefined;
    if (blob) {
      tasks.push({ ...base, file: blob.file, size: blob.size, label: blob.paths[0] ?? blob.sha256 });
      continue;
    }
    const named = u.kind === "site" && u.path ? byPath.get(u.path) : undefined;
    const site =
      u.kind !== "site"
        ? undefined
        : named?.sha256 === u.sha256
          ? named
          : byContent.get(u.sha256);
    if (site) {
      tasks.push({ ...base, file: path.join(built.dir, site.path), size: site.size, label: site.path });
      continue;
    }
    return err(
      publishError(
        "INTERNAL_ERROR",
        `The server asked for an upload this publish did not plan (${u.kind} ${u.path ?? u.sha256}).`,
      ),
    );
  }
  return ok(tasks);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const steps = async (ctx: {
  workspaceId: string;
  workspaceName: string;
  allowRemix: boolean | undefined;
  run: Run;
  state: RunState;
  watch: ActivityWatch;
  emit: (event: PublishEvent) => void;
}): Promise<Result<PublishResult, PublishError>> => {
  const { workspaceId, run, state, watch, emit } = ctx;
  const signal = run.controller.signal;

  const idle = await ensureIdle(watch);
  if (idle.isErr()) return err(idle.error);
  if (signal.aborted) return err(CANCELLED);

  const staging = await createStagingDir();
  state.staging = staging;
  run.staging = staging;
  void sweepStaleStaging(
    new Set([...runs.values()].flatMap((r) => (r.staging ? [r.staging] : []))),
  ).catch(() => {});

  // ── snapshot ──
  emit({ type: "step", step: "snapshot" });
  const sourceDir = getWorkspaceSourcePath(workspaceId);
  const plan = await scanWorkspace(sourceDir, { signal });
  if (plan.isErr()) return err(mapSnapshotError(plan.error));
  const planLimits = checkPlanLimits(plan.value);
  if (planLimits.isErr()) return err(planLimits.error);

  const stagedDir = path.join(staging, "source");
  const stagedResult = await stageSnapshot(plan.value, stagedDir, {
    signal,
    maxBytes: MAX_UNCOMPRESSED_BYTES,
  });
  if (stagedResult.isErr()) {
    const mapped = mapSnapshotError(stagedResult.error);
    return err(
      mapped.code === "PUBLISH_TOO_LARGE"
        ? { ...mapped, details: { ...mapped.details, largestFiles: largestFiles(plan.value) } }
        : mapped,
    );
  }
  const staged: StagedSnapshot = stagedResult.value;

  // A turn that ran or queued during scan/stage may have left the staged tree
  // between two states.
  const idleAfterStage = await ensureIdle(watch);
  if (idleAfterStage.isErr()) return err(idleAfterStage.error);
  if (signal.aborted) return err(CANCELLED);

  const packedResult = await packSnapshot(
    staged,
    {
      archiveFile: path.join(staging, "snapshot.tar.gz"),
      blobDir: path.join(staging, "blobs"),
    },
    { signal },
  );
  if (packedResult.isErr()) {
    // Pack's TOO_LARGE is manifest.json over its cap: too many files or too
    // long paths, not too many bytes (stage's TOO_LARGE).
    return err(
      packedResult.error.code === "TOO_LARGE"
        ? publishError(
            "PUBLISH_TOO_LARGE",
            "This canvas has too many files, or file paths too long, to publish.",
            { fileCount: staged.manifest.files.length },
          )
        : mapSnapshotError(packedResult.error),
    );
  }
  const packed = packedResult.value;

  const snapshotLimits = checkSnapshotLimits(packed);
  if (snapshotLimits.isErr()) return err(snapshotLimits.error);
  if (signal.aborted) return err(CANCELLED);

  // ── build ──
  emit({ type: "step", step: "building" });
  const builtResult = await buildWorkspaceSite({
    workspaceId,
    workspaceName: ctx.workspaceName,
    stagedSourceDir: stagedDir,
    nodeModulesDir: path.join(sourceDir, "node_modules"),
    outDir: path.join(staging, "site"),
    cacheDir: path.join(staging, "vite-cache"),
    signal,
    onLog: (line) => emit({ type: "build-log", line }),
  });
  if (builtResult.isErr()) return err(mapSiteBuildError(builtResult.error));
  const built = builtResult.value;

  const siteLimits = checkSiteLimits(built);
  if (siteLimits.isErr()) return err(siteLimits.error);

  const idleAfterBuild = await ensureIdle(watch);
  if (idleAfterBuild.isErr()) return err(idleAfterBuild.error);
  if (signal.aborted) return err(CANCELLED);

  // ── upload ──
  const body = beginRequest({
    workspaceId,
    workspaceName: ctx.workspaceName,
    allowRemix: ctx.allowRemix,
    packed,
    built,
  });
  if (body.isErr()) return err(body.error);

  // The new session replaces whatever an earlier run left unfinished, but
  // only once begin has answered with it and the run goes on: a run that ends
  // before that (cancelled, a failed build, a begin that failed, was refused
  // or was cancelled) leaves it, and main's follow-up of it, as they were.
  // Until then that record is only read (the run holds the workspace, so no
  // retry of it starts), and a retry of it in flight was waited for before
  // the run got this far. A begin whose answer was lost may still have made a
  // session, but nothing uploads to or completes that one, so the earlier
  // session committing after it conflicts with nothing. "uploading" is the
  // step that tells the renderer the earlier session was let go, so it comes
  // after begin.
  const begun = await beginPublish(body.value, { signal });
  if (begun.isErr()) {
    return err(signal.aborted ? CANCELLED : mapCloudError(begun.error, packed.manifest));
  }
  const publishId = begun.value.publish.id;
  state.session = publishId;
  rememberBegun(publishId, Date.parse(begun.value.publish.expiresAt));
  if (signal.aborted) return err(CANCELLED);
  forgetUnfinished(workspaceId);
  emit({ type: "step", step: "uploading" });
  const objects = planObjectCount(body.value);

  const tasks = uploadTasks(begun.value.uploads, packed, built);
  if (tasks.isErr()) return err(tasks.error);

  const totalBytes = sumSizes(tasks.value);
  emit({
    type: "upload-progress",
    uploadedBytes: 0,
    totalBytes,
    uploadedFiles: 0,
    totalFiles: tasks.value.length,
  });
  const uploaded = await uploadAll(tasks.value, {
    signal,
    onProgress: (p) => emit({ type: "upload-progress", ...p }),
  });
  if (uploaded.isErr()) return err(fromUploadError(uploaded.error));
  if (signal.aborted) return err(CANCELLED);

  // ── finish ──
  // From here the server may commit at any moment: cancel is inert and abort
  // is never sent.
  run.finishing = true;
  state.session = null;
  emit({ type: "step", step: "finishing" });

  // Distinct contents uploaded: files that share content are stored once.
  const siteUploads = new Set(
    begun.value.uploads.filter((u) => u.kind === "site").map((u) => u.sha256),
  ).size;
  const toResult = (site: SiteStatus, version: number): PublishResult => ({
    url: site.url,
    slug: site.slug,
    version,
    allowRemix: site.allowRemix,
    status: site,
    snapshot: {
      fileCount: packed.fileCount,
      archiveBytes: packed.archiveSize,
      largeFileCount: packed.manifest.files.filter((f) => f.storage === "blob").length,
      snapshotBytes: packed.snapshotBytes,
    },
    site: {
      fileCount: siteFilesOf(built).length,
      uploadedFiles: siteUploads,
      skipped: built.skipped,
    },
    excluded: staged.excluded,
    notes: notesFor(staged.excluded),
  });

  // Whether every attempt was refused by the rate limiter, which answers
  // before the server does anything: then the publish certainly did not
  // commit, and "rate limited" is the answer rather than "outcome unknown".
  let onlyRateLimited = true;
  let lastError: CloudError | null = null;
  for (let attempt = 1; attempt <= COMPLETE_ATTEMPTS; attempt++) {
    const completed = await completePublish(publishId, objects);
    if (completed.isOk()) {
      return ok(toResult(completed.value.site, completed.value.version));
    }
    if (!isRetryableComplete(completed.error)) {
      return err(mapCloudError(completed.error, packed.manifest));
    }
    lastError = completed.error;
    if (completed.error.code !== "RATE_LIMITED") onlyRateLimited = false;
    if (attempt < COMPLETE_ATTEMPTS) {
      await sleep(publishTiming.completeRetryBaseMs * 2 ** (attempt - 1));
    }
  }

  if (onlyRateLimited && lastError) return err(mapCloudError(lastError));

  // Still no definite answer: ask the server what became of the session.
  // publishId lets "Check status" ask about this session later
  // (getPublishOutcome), rather than guess from the site's version; the
  // session kept here lets it send complete again, since nothing else moves a
  // pending session on (and only GC's hourly re-sync would switch a committed
  // one over).
  const outcomeUnknown = (
    message = "The publish may still finish. Check again in a moment.",
  ): Result<PublishResult, PublishError> => {
    keepUnfinished(workspaceId, {
      publishId,
      expiresAt: Date.parse(begun.value.publish.expiresAt),
      objects,
    });
    return err(publishError("PUBLISH_OUTCOME_UNKNOWN", message, { publishId }));
  };
  const session = await getPublishSession(publishId);
  if (session.isErr()) {
    return session.error.code === "SIGNED_OUT" ? err(SIGNED_OUT) : outcomeUnknown();
  }
  const { status, resultVersion, live } = session.value;
  if (status === "completed") markCommitted(publishId);
  if (status === "completed" && resultVersion !== null) {
    // Committed is not live: the server commits, then switches the site
    // over. The read says which (retrying the switch-over first), so a live
    // version needs nothing more; otherwise complete (idempotent: it re-syncs
    // the switch-over) is what says the publish is live.
    if (live) return ok(toResult(session.value.site, resultVersion));
    const confirmed = await completePublish(publishId, objects);
    if (confirmed.isOk()) {
      return ok(toResult(confirmed.value.site, confirmed.value.version));
    }
    if (confirmed.error.code === "SIGNED_OUT") return err(SIGNED_OUT);
    if (!isRetryableComplete(confirmed.error)) {
      return err(mapCloudError(confirmed.error, packed.manifest));
    }
    return outcomeUnknown(NOT_LIVE_YET);
  }
  if (status === "pending") return outcomeUnknown();
  // aborted or expired: it can no longer complete.
  return err(
    mapCloudError({ status: 410, code: "PUBLISH_EXPIRED", message: `Session ${status}` }),
  );
};

// ============================================================================
// Site status
// ============================================================================

// What became of a publish session that ended PUBLISH_OUTCOME_UNKNOWN (its
// publishId is in that error's details). While this process kept its session
// and it is pending, or committed without the answer that it is live, it is
// also the retry: complete is sent once more (it is idempotent, and switches
// the site over to a committed version), and a session the server now
// refuses for good is aborted, so the answer is "it will not go live" rather
// than "pending" until it expires. A committed session is "completed" only
// once it is live (the server's read says so, or complete confirms it); until
// then it reads "pending", since visitors still get the previous version.
export const getPublishOutcome = async (
  workspaceId: string,
  publishId: string,
): Promise<Result<PublishSessionResponse, PublishError>> => {
  const result = await getPublishSession(publishId);
  const held = unfinished.get(workspaceId);
  const isHeld = held?.publishId === publishId;
  if (result.isErr()) {
    if (result.error.code === "PUBLISH_NOT_FOUND") {
      const gone = await goneOutcome(workspaceId, publishId, result.error);
      // Only a final answer lets the session go: a 404 before it expired is
      // another account's answer, and it may still finish under its own.
      if (gone.isOk() && held && isHeld) dropUnfinished(workspaceId, held);
      return gone;
    }
    return err(mapCloudError(result.error));
  }
  const session = result.value;
  if (session.status === "completed") markCommitted(publishId);
  if (!held || !isHeld) return ok(asSeen(session));
  // While a run holds the workspace, only read (the run waits for no retry
  // started now).
  if (runs.has(workspaceId)) return ok(asSeen(session));
  if (session.live || (session.status !== "pending" && session.status !== "completed")) {
    dropUnfinished(workspaceId, held);
    return ok(session);
  }
  // One attempt at a time, however many checks arrive.
  if (!held.inFlight) {
    const attempt = finishUnfinished(workspaceId, held, result.value).finally(() => {
      held.inFlight = null;
      if (retries.get(workspaceId) === attempt) retries.delete(workspaceId);
    });
    held.inFlight = attempt;
    retries.set(workspaceId, attempt);
  }
  return held.inFlight;
};

// A committed session visitors do not see yet reads pending.
const asSeen = (session: PublishSessionResponse): PublishSessionResponse =>
  session.status === "completed" && !session.live ? { ...session, status: "pending" } : session;

// A session the server answers 404 about. The server deletes a session that
// never committed (pending, aborted or expired) a day after it expired, a
// committed one a week after it began, and answers 404 for another account's
// session as well, so the 404 by itself proves neither that it committed nor
// that it did not. What this process saw of the session decides (see
// begunSessions):
// - seen committed: it committed and has since been superseded; it reads as
//   done, with the site as it is now (resultVersion unknown);
// - never seen committed, and past its expiry: it can no longer commit, and
//   nothing showed it did, so it reads as expired (it never went live);
// - otherwise (not expired yet, so another account's answer; or a session
//   this process did not begin): the server's error, which proves nothing.
// Without a site (unpublished since) it is the server's error as well.
const goneOutcome = async (
  workspaceId: string,
  publishId: string,
  notFound: CloudError,
): Promise<Result<PublishSessionResponse, PublishError>> => {
  const begun = begunSessions.get(publishId);
  const committed = begun?.committed === true;
  const expired = begun !== undefined && !committed && Date.now() > begun.expiresAt;
  if (!committed && !expired) return err(mapCloudError(notFound));
  const site = await fetchSiteStatus(workspaceId);
  if (site.isErr()) {
    return err(site.error.code === "SIGNED_OUT" ? SIGNED_OUT : mapCloudError(site.error));
  }
  if (!site.value) return err(mapCloudError(notFound));
  return ok(
    committed
      ? { status: "completed", resultVersion: null, live: true, site: site.value }
      : { status: "expired", resultVersion: null, live: false, site: site.value },
  );
};

const finishUnfinished = async (
  workspaceId: string,
  held: Unfinished,
  session: PublishSessionResponse,
): Promise<Result<PublishSessionResponse, PublishError>> => {
  const committed = session.status === "completed";
  if (committed || !held.refused) {
    const completed = await completePublish(held.publishId, held.objects);
    if (completed.isOk()) {
      markCommitted(held.publishId);
      dropUnfinished(workspaceId, held);
      return ok({
        status: "completed",
        resultVersion: completed.value.version,
        live: true,
        site: completed.value.site,
      });
    }
    // Committed but not switched over yet: not live, so still pending.
    if (isRetryableComplete(completed.error)) return ok({ ...session, status: "pending" });
    if (completed.error.code === "SIGNED_OUT") return err(SIGNED_OUT);
    // A committed session has nothing to abort; the refusal is the answer.
    if (committed) {
      dropUnfinished(workspaceId, held);
      return err(mapCloudError(completed.error));
    }
    held.refused = completed.error;
  }

  // Refused for good (uploads missing, published from elsewhere, expired…):
  // this session can never commit. Kept until the abort lands, so the next
  // check tries it again.
  const aborted = await abortPublish(held.publishId);
  if (aborted.isErr()) return err(mapCloudError(held.refused));
  dropUnfinished(workspaceId, held);
  const after = await getPublishSession(held.publishId);
  if (after.isErr()) return err(mapCloudError(after.error));
  return ok(after.value);
};

// null when the canvas was never published, or when signed out.
export const getPublishStatus = async (
  workspaceId: string,
): Promise<Result<SiteStatus | null, PublishError>> => {
  const result = await fetchSiteStatus(workspaceId);
  if (result.isErr()) {
    return result.error.code === "SIGNED_OUT"
      ? ok(null)
      : err(mapCloudError(result.error));
  }
  return ok(result.value);
};

export const setAllowRemix = async (
  workspaceId: string,
  allowRemix: boolean,
): Promise<Result<SiteStatus, PublishError>> => {
  const current = await fetchSiteStatus(workspaceId);
  if (current.isErr()) return err(mapCloudError(current.error));
  if (!current.value) {
    return err(
      publishError("INTERNAL_ERROR", "This canvas hasn't been published yet."),
    );
  }
  const patched = await patchSite(current.value.siteId, { allowRemix });
  if (patched.isErr()) return err(mapCloudError(patched.error));
  return ok(patched.value);
};

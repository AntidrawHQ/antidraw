import fs from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { getWorkspace } from "@/main/api/services/workspace.service";
import { getAccount, type AccountError } from "@/main/services/account.service";
import {
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
  type CompletePublishRequest,
} from "./cloud-publish";
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

// The entry files, in the order the server writes them.
const ENTRY_FILES = ["preview.html", "canvas.json", "index.html"] as const;

const COMPLETE_ATTEMPTS = 5;

// Complete's retry backoff is base·2^(n-1) (2, 4, 8, 16 s). Tests shorten it.
export const publishTiming = { completeRetryBaseMs: 2_000 };

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
  "ENTRY_MISMATCH",
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
const isRetryableComplete = (e: CloudError) =>
  e.code === "SERVER_UNREACHABLE" ||
  (e.status >= 500 && e.code !== "SIGNED_OUT") ||
  (e.status === 409 && e.code === "PUBLISH_IN_PROGRESS");

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

  const onCallerAbort = () => {
    if (!run.finishing) run.controller.abort();
  };
  if (opts.signal.aborted) onCallerAbort();
  else opts.signal.addEventListener("abort", onCallerAbort, { once: true });

  const channel = createChannel<PublishEvent>();
  const task = execute(workspaceId, opts.allowRemix, run, channel.push)
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
  uploadsStarted: boolean;
};

const execute = async (
  workspaceId: string,
  allowRemix: boolean | undefined,
  run: Run,
  emit: (event: PublishEvent) => void,
): Promise<Result<PublishResult, PublishError>> => {
  emit({ type: "step", step: "checking" });

  const account = await getAccount();
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

  const state: RunState = { staging: null, session: null, uploadsStarted: false };
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

  if (outcome.isErr()) {
    if (state.session) {
      // Best effort: the server expires the session anyway.
      const session = state.session;
      void abortPublish(session).then((r) => {
        if (r.isErr()) console.error(`Couldn't abort publish ${session}:`, r.error);
      });
    }
    if (state.uploadsStarted) {
      outcome = err({
        ...outcome.error,
        details: { ...outcome.error.details, publicFilesMayHaveChanged: true },
      });
    }
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

const sumSizes = (files: { size: number }[]) =>
  files.reduce((sum, f) => sum + f.size, 0);

// The pre-checks mirror the server's limits, so an oversized publish is
// refused before anything is uploaded.
const checkSnapshotLimits = (
  packed: PackedSnapshot,
): Result<void, PublishError> => {
  const largeFileCount = packed.manifest.files.filter(
    (f) => f.storage === "blob",
  ).length;
  const reason =
    packed.snapshotBytes > MAX_SNAPSHOT_BYTES
      ? "This canvas is too large to publish."
      : packed.uncompressedBytes > MAX_UNCOMPRESSED_BYTES
        ? "This canvas's files add up to more than can be published."
        : packed.fileCount > MAX_SNAPSHOT_FILES
          ? "This canvas has more files than can be published."
          : largeFileCount > MAX_LARGE_FILES
            ? "This canvas has more large files than can be published."
            : null;
  if (!reason) return ok(undefined);
  return err(
    publishError("PUBLISH_TOO_LARGE", reason, {
      largestFiles: largestFiles(packed.manifest),
      limitBytes: MAX_SNAPSHOT_BYTES,
      snapshotBytes: packed.snapshotBytes,
      uncompressedBytes: packed.uncompressedBytes,
      fileCount: packed.fileCount,
      largeFileCount,
    }),
  );
};

const checkSiteLimits = (built: BuiltSite): Result<void, PublishError> => {
  const siteBytes = sumSizes(built.files) + sumSizes(built.entries);
  if (built.files.length <= MAX_SITE_FILES && siteBytes <= MAX_SITE_BYTES) {
    return ok(undefined);
  }
  return err(
    publishError("SITE_TOO_LARGE", "The built site is too large to publish.", {
      siteFileCount: built.files.length,
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
  const entries = ENTRY_FILES.map((name) => built.entries.find((e) => e.path === name));
  if (entries.some((e) => !e) || built.entries.length !== ENTRY_FILES.length) {
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
      files: built.files.map(({ path, sha256, size, contentType, immutable }) => ({
        path,
        sha256,
        size,
        contentType,
        immutable,
      })),
      entries: ENTRY_FILES.map((name, i) => ({
        path: name,
        sha256: entries[i]!.sha256,
        size: entries[i]!.size,
      })),
    },
  });
};

// Upload instructions → local files. Only what this publish planned is
// uploaded: an instruction for anything else is a contract bug.
const uploadTasks = (
  uploads: { kind: "source" | "blob" | "site"; sha256: string; path?: string; url: string; headers: Record<string, string> }[],
  packed: PackedSnapshot,
  built: BuiltSite,
): Result<UploadTask[], PublishError> => {
  const blobs = new Map(packed.blobs.map((b) => [b.sha256, b]));
  const siteFiles = new Map(built.files.map((f) => [f.path, f]));
  const tasks: UploadTask[] = [];
  for (const u of uploads) {
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
    const site = u.kind === "site" && u.path ? siteFiles.get(u.path) : undefined;
    if (site && site.sha256 === u.sha256) {
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

  const stagedDir = path.join(staging, "source");
  const stagedResult = await stageSnapshot(plan.value, stagedDir, { signal });
  if (stagedResult.isErr()) return err(mapSnapshotError(stagedResult.error));
  const staged: StagedSnapshot = stagedResult.value;

  // A turn that ran or queued during scan/stage may have left the staged tree
  // between two states.
  const idleAfterStage = await ensureIdle(watch);
  if (idleAfterStage.isErr()) return err(idleAfterStage.error);

  const packedResult = await packSnapshot(staged, {
    archiveFile: path.join(staging, "snapshot.tar.gz"),
    blobDir: path.join(staging, "blobs"),
  });
  if (packedResult.isErr()) return err(mapSnapshotError(packedResult.error));
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
  emit({ type: "step", step: "uploading" });
  const body = beginRequest({
    workspaceId,
    workspaceName: ctx.workspaceName,
    allowRemix: ctx.allowRemix,
    packed,
    built,
  });
  if (body.isErr()) return err(body.error);

  const begun = await beginPublish(body.value);
  if (begun.isErr()) return err(mapCloudError(begun.error, packed.manifest));
  const publishId = begun.value.publish.id;
  state.session = publishId;
  if (signal.aborted) return err(CANCELLED);

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
  state.uploadsStarted = tasks.value.length > 0;
  const uploaded = await uploadAll(tasks.value, {
    signal,
    onProgress: (p) => emit({ type: "upload-progress", ...p }),
  });
  if (uploaded.isErr()) return err(fromUploadError(uploaded.error));

  const entries: CompletePublishRequest["entries"] = [];
  for (const name of ENTRY_FILES) {
    const bytes = await fs.readFile(path.join(built.dir, name));
    entries.push({ path: name, contentBase64: bytes.toString("base64") });
  }
  if (signal.aborted) return err(CANCELLED);

  // ── finish ──
  // From here the server may commit at any moment: cancel is inert and abort
  // is never sent.
  run.finishing = true;
  state.session = null;
  emit({ type: "step", step: "finishing" });

  const siteUploads = begun.value.uploads.filter((u) => u.kind === "site").length;
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
      fileCount: built.files.length + built.entries.length,
      uploadedFiles: siteUploads,
      skipped: built.skipped,
    },
    excluded: staged.excluded,
    notes: notesFor(staged.excluded),
  });

  for (let attempt = 1; attempt <= COMPLETE_ATTEMPTS; attempt++) {
    const completed = await completePublish(publishId, { entries });
    if (completed.isOk()) {
      return ok(toResult(completed.value.site, completed.value.version));
    }
    if (!isRetryableComplete(completed.error)) {
      return err(mapCloudError(completed.error, packed.manifest));
    }
    if (attempt < COMPLETE_ATTEMPTS) {
      await sleep(publishTiming.completeRetryBaseMs * 2 ** (attempt - 1));
    }
  }

  // Still no definite answer: ask the server what became of the session.
  const session = await getPublishSession(publishId);
  if (session.isErr()) {
    return err(
      session.error.code === "SIGNED_OUT"
        ? SIGNED_OUT
        : publishError(
            "PUBLISH_OUTCOME_UNKNOWN",
            "The publish may still finish. Check again in a moment.",
          ),
    );
  }
  const { status, resultVersion, site } = session.value;
  if (status === "completed" && resultVersion !== null) {
    return ok(toResult(site, resultVersion));
  }
  if (status === "pending") {
    return err(
      publishError(
        "PUBLISH_OUTCOME_UNKNOWN",
        "The publish may still finish. Check again in a moment.",
      ),
    );
  }
  // aborted or expired: it can no longer complete.
  return err(
    mapCloudError({ status: 410, code: "PUBLISH_EXPIRED", message: `Session ${status}` }),
  );
};

// ============================================================================
// Site status
// ============================================================================

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

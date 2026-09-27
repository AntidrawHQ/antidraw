import { create } from "zustand";
import { MutationObserver, type QueryClient } from "@tanstack/react-query";
import type { PublishResult, PublishStep, SiteStatus } from "@/main/api";
import { cancelPublish, getPublishSession } from "./api";
import { queryKeys } from "./query-keys";
import {
  AccountRequestError,
  publishMutationOptions,
  publishStatusQueryOptions,
  type PublishVariables,
} from "./account-ops";

/* ────────────────────────────────────────────────────────────
   Publishes, one per workspace, kept outside any component. The
   titlebar shows one PublishButton for whichever workspace is
   active; everything a publish produces (its progress, its result,
   its failure) belongs to the workspace it was started for, so
   switching workspaces never shows or acts on another one's run.
   ──────────────────────────────────────────────────────────── */

export type PublishProgress = { step: PublishStep; percent: number | null };

// What "Check status" found after PUBLISH_OUTCOME_UNKNOWN:
// pending: the session has not committed yet (or, without its publishId, the
//   site has not moved past the version it had before the publish).
// ended: the session was aborted or expired; it will never go live.
// unknown: no publishId, and the version before the publish could not be
//   read, so a newer one proves nothing.
// failed: the status could not be read now.
export type StatusCheck = "pending" | "ended" | "unknown" | "failed";

export type PublishRun = { id: number } & (
  | {
      phase: "publishing";
      progress: PublishProgress;
      cancelling: boolean;
      // False for the first CANCEL_ARM_MS: the button that started the
      // publish turns into Cancel under the pointer, and the second click of
      // a double-click (or a held Enter) must not cancel what the first began.
      cancelArmed: boolean;
    }
  | { phase: "published"; url: string; result: PublishResult | null } // null: found by "Check status"
  | {
      phase: "failed";
      error: AccountRequestError;
      checking: boolean; // a "Check status" is in flight
      check: StatusCheck | null;
    }
);

export const usePublishRuns = create<{ runs: Record<string, PublishRun> }>(() => ({
  runs: {},
}));

const getRun = (workspaceId: string): PublishRun | undefined =>
  usePublishRuns.getState().runs[workspaceId];

const setRun = (workspaceId: string, run: PublishRun | null) =>
  usePublishRuns.setState((s) => {
    const runs = { ...s.runs };
    if (run) runs[workspaceId] = run;
    else delete runs[workspaceId];
    return { runs };
  });

// Changes the run only while it is still run `id`, in `phase`: callbacks
// of an older run (dismissed, retried) must not touch the next one.
const patchRun = <P extends PublishRun["phase"]>(
  workspaceId: string,
  id: number,
  phase: P,
  patch: Partial<Extract<PublishRun, { phase: P }>>,
) => {
  const run = getRun(workspaceId);
  if (run?.id !== id || run.phase !== phase) return;
  setRun(workspaceId, { ...run, ...patch } as PublishRun);
};

let nextRunId = 1;

export const CANCEL_ARM_MS = 600;

// Whether Cancel is offered for this run: armed, not already cancelling, and
// not finishing (main ignores a cancel from there on).
export const canCancelPublish = (
  run: PublishRun | undefined | null,
): run is Extract<PublishRun, { phase: "publishing" }> =>
  run?.phase === "publishing" &&
  run.cancelArmed &&
  !run.cancelling &&
  run.progress.step !== "finishing";

// The site's head version before each workspace's latest publish, read from
// the server when it starts (never from a render's cached status, which may
// not have loaded). null when it could not be read. Read alongside the
// publish, not before it: a publish commits only at its very end, so a late
// answer can only be the same version or the new one, which reads as "not
// live yet", never as a false "published".
const baselines = new Map<string, Promise<number | null>>();

const readStatus = (queryClient: QueryClient, workspaceId: string) =>
  queryClient.fetchQuery({
    ...publishStatusQueryOptions(workspaceId),
    staleTime: 0,
    retry: false,
  });

export const judgeOutcome = (
  baseline: number | null,
  site: SiteStatus | null,
): "live" | "pending" | "unknown" => {
  if (baseline === null) return "unknown";
  return site && site.headVersion > baseline ? "live" : "pending";
};

export type PublishOutcome =
  | "published"
  | "failed"
  | "cancelled"
  | "signed-out"
  | "already-publishing";

export const startPublish = async (
  queryClient: QueryClient,
  workspaceId: string,
): Promise<PublishOutcome> => {
  if (getRun(workspaceId)?.phase === "publishing") return "already-publishing";
  // An unfinished earlier session is still followed until this run reaches
  // "uploading": main lets it go only once the new session begins, and keeps
  // finishing it after a run that ends before that (cancelled, refused,
  // offline).
  const id = nextRunId++;
  setRun(workspaceId, {
    id,
    phase: "publishing",
    progress: { step: "checking", percent: null },
    cancelling: false,
    cancelArmed: false,
  });
  const arm = setTimeout(
    () => patchRun(workspaceId, id, "publishing", { cancelArmed: true }),
    CANCEL_ARM_MS,
  );
  baselines.set(
    workspaceId,
    readStatus(queryClient, workspaceId).then(
      (site) => site?.headVersion ?? 0,
      () => null,
    ),
  );

  const variables: PublishVariables = {
    workspaceId,
    onProgress: (event) => {
      if (event.type === "step") {
        // Main has let the earlier session go (see above).
        if (event.step === "uploading") stopFollowing(workspaceId);
        patchRun(workspaceId, id, "publishing", {
          progress: { step: event.step, percent: null },
          // Main ignores a cancel from here on: the server may have committed.
          ...(event.step === "finishing" ? { cancelling: false } : {}),
        });
      } else if (event.type === "upload-progress") {
        patchRun(workspaceId, id, "publishing", {
          progress: {
            step: "uploading",
            percent:
              event.totalBytes > 0
                ? Math.min(100, Math.floor((event.uploadedBytes / event.totalBytes) * 100))
                : null,
          },
        });
      }
    },
  };

  // A mutation with no component behind it: the hook-level callbacks (status
  // cache, SIGNED_OUT) run as they do for useMutation.
  const observer = new MutationObserver(queryClient, publishMutationOptions(queryClient));
  try {
    const result = await observer.mutate(variables);
    if (getRun(workspaceId)?.id === id) {
      setRun(workspaceId, { id, phase: "published", url: result.url, result });
    }
    return "published";
  } catch (e) {
    const error =
      e instanceof AccountRequestError
        ? e
        : new AccountRequestError("INTERNAL_ERROR", "The publish stopped before it finished.");
    const current = getRun(workspaceId)?.id === id;
    if (error.code === "SIGNED_OUT" || error.code === "CANCELLED") {
      // A quiet end: nothing a visitor sees changed (the site switches over
      // only when a publish commits).
      if (current) {
        setRun(workspaceId, null);
        // Signed out: the sign-in panel comes up in the run's place, and
        // either publishes again or closes (which brings the answer back).
        if (error.code === "CANCELLED") showHeldAnswer(workspaceId);
      }
      return error.code === "SIGNED_OUT" ? "signed-out" : "cancelled";
    }
    console.error("Publish failed:", error);
    if (current) {
      setRun(workspaceId, { id, phase: "failed", error, checking: false, check: null });
      follow(queryClient, workspaceId, id, error);
    }
    return "failed";
  } finally {
    clearTimeout(arm);
    // Detaches the observer so the settled mutation can be garbage collected.
    observer.reset();
  }
};

// Stops a publish before it reaches `finishing`; after that main ignores it.
// The run ends when the stream reports CANCELLED (or its real outcome, if
// the cancel lost the race with `finishing`). Ignored until the run's Cancel
// is armed. When main had nothing to cancel (its run not registered yet, or
// already finishing) the run goes on, so it stops showing "Cancelling".
export const cancelPublishRun = async (workspaceId: string) => {
  const run = getRun(workspaceId);
  if (!canCancelPublish(run)) return;
  const { id } = run;
  patchRun(workspaceId, id, "publishing", { cancelling: true });
  const result = await cancelPublish(workspaceId);
  if (result.isErr() || !result.value) {
    patchRun(workspaceId, id, "publishing", { cancelling: false });
  }
};

const showPublished = (workspaceId: string, id: number, url: string) => {
  const current = getRun(workspaceId);
  if (current?.id === id && current.phase === "failed") {
    setRun(workspaceId, { id, phase: "published", url, result: null });
  }
};

// ── Finishing in the background ─────────────────────────────
// A publish that ended PUBLISH_OUTCOME_UNKNOWN is finished by main sending
// complete again: on its own backoff (followUnfinished in main's
// publish.service.ts), and on each ask about the session. Only asking tells
// the user how it turned out, so that must not depend on the "Still
// finishing" panel staying open (it opens on its own, and closes on the X).
// Until the server gives a final answer, the session is asked about on a
// backoff whether or not the panel is showing; the answer then shows on the
// run, or brings it back if it was closed: the published toast, or "did not
// go live".

// The delays between asks: the last one repeats.
export const FOLLOW_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 60_000];
// Past the session's lifetime on the server (2 h), by when it is expired.
export const FOLLOW_MAX_MS = 150 * 60_000;

type Follow = {
  queryClient: QueryClient;
  runId: number;
  error: AccountRequestError;
  publishId: string;
  startedAt: number;
  asks: number;
  timer: ReturnType<typeof setTimeout> | null;
};
const follows = new Map<string, Follow>();

// Whether a failure is followed in the background (exported for the panel):
// main names the session, and only then can asking finish it.
export const isFollowedFailure = (error: AccountRequestError) =>
  error.code === "PUBLISH_OUTCOME_UNKNOWN" && !!error.details?.publishId;

// A followed session's final answer that came while a newer run of the
// workspace was up (still before "uploading", or showing its failure). It is
// shown once that run is gone: dismissed, or ended quietly. Dropped with the
// follow, when a newer run begins its own session.
type HeldAnswer = { runId: number; error: AccountRequestError; status: string; site: SiteStatus };
const heldAnswers = new Map<string, HeldAnswer>();

// Stops following a workspace's unfinished publish, or every one.
export const stopFollowing = (workspaceId?: string) => {
  for (const [ws, f] of follows) {
    if (workspaceId !== undefined && ws !== workspaceId) continue;
    if (f.timer) clearTimeout(f.timer);
    follows.delete(ws);
  }
  if (workspaceId === undefined) heldAnswers.clear();
  else heldAnswers.delete(workspaceId);
};

const follow = (
  queryClient: QueryClient,
  workspaceId: string,
  runId: number,
  error: AccountRequestError,
) => {
  const publishId = error.details?.publishId;
  if (!isFollowedFailure(error) || !publishId) return;
  stopFollowing(workspaceId);
  const f: Follow = {
    queryClient,
    runId,
    error,
    publishId,
    startedAt: Date.now(),
    asks: 0,
    timer: null,
  };
  follows.set(workspaceId, f);
  scheduleAsk(workspaceId, f);
};

const scheduleAsk = (workspaceId: string, f: Follow) => {
  const delay = FOLLOW_DELAYS_MS[Math.min(f.asks, FOLLOW_DELAYS_MS.length - 1)] ?? 60_000;
  f.timer = setTimeout(() => void ask(workspaceId, f), delay);
};

const ask = async (workspaceId: string, f: Follow) => {
  f.timer = null;
  if (follows.get(workspaceId) !== f) return;
  f.asks++;
  const session = await getPublishSession(workspaceId, f.publishId);
  if (follows.get(workspaceId) !== f) return;
  if (session.isOk() && session.value.status !== "pending") {
    settleFollowed(workspaceId, f, session.value);
    return;
  }
  // Pending, or not readable now (offline, signed out): ask again later,
  // until the session must have expired.
  if (Date.now() - f.startedAt >= FOLLOW_MAX_MS) {
    follows.delete(workspaceId);
    return;
  }
  scheduleAsk(workspaceId, f);
};

// The server's final answer about a followed session. Shown on its run while
// that is still up; brought back when it was closed. While a newer run of the
// workspace is up, held until that run is gone.
const settleFollowed = (
  workspaceId: string,
  f: Follow,
  { status, site }: { status: string; site: SiteStatus },
) => {
  stopFollowing(workspaceId);
  if (status === "completed") {
    f.queryClient.setQueryData(queryKeys.publish.status(workspaceId), site);
  }
  const answer: HeldAnswer = { runId: f.runId, error: f.error, status, site };
  const run = getRun(workspaceId);
  const shown = run?.id === f.runId && run.phase === "failed";
  if (run && !shown) heldAnswers.set(workspaceId, answer);
  else showAnswer(workspaceId, answer);
};

const showAnswer = (workspaceId: string, { runId, error, status, site }: HeldAnswer) => {
  if (status === "completed") {
    setRun(workspaceId, { id: runId, phase: "published", url: site.url, result: null });
  } else {
    setRun(workspaceId, { id: runId, phase: "failed", error, checking: false, check: "ended" });
  }
};

// Shows a held answer once the workspace has no run up.
const showHeldAnswer = (workspaceId: string) => {
  const answer = heldAnswers.get(workspaceId);
  if (!answer || getRun(workspaceId)) return;
  heldAnswers.delete(workspaceId);
  showAnswer(workspaceId, answer);
};

// PUBLISH_OUTCOME_UNKNOWN: the server may still commit. Main names the
// session in the error (details.publishId), and the server's answer about it
// is exact. Without one, live only when the site's head moved past the
// version it had before this publish.
export const checkPublishStatus = async (
  queryClient: QueryClient,
  workspaceId: string,
) => {
  const run = getRun(workspaceId);
  if (run?.phase !== "failed" || run.checking) return;
  const { id } = run;
  patchRun(workspaceId, id, "failed", { checking: true, check: null });

  const publishId = run.error.details?.publishId;
  if (publishId) {
    const session = await getPublishSession(workspaceId, publishId);
    if (session.isErr()) {
      patchRun(workspaceId, id, "failed", { checking: false, check: "failed" });
      return;
    }
    const { status, site } = session.value;
    // Final: nothing left to finish in the background.
    if (status !== "pending" && follows.get(workspaceId)?.runId === id) {
      stopFollowing(workspaceId);
    }
    if (status === "completed") {
      queryClient.setQueryData(queryKeys.publish.status(workspaceId), site);
      showPublished(workspaceId, id, site.url);
    } else {
      patchRun(workspaceId, id, "failed", {
        checking: false,
        check: status === "pending" ? "pending" : "ended",
      });
    }
    return;
  }

  const baseline = (await baselines.get(workspaceId)) ?? null;
  let site: SiteStatus | null;
  try {
    site = await readStatus(queryClient, workspaceId);
  } catch {
    patchRun(workspaceId, id, "failed", { checking: false, check: "failed" });
    return;
  }

  const outcome = judgeOutcome(baseline, site);
  if (outcome === "live" && site) {
    showPublished(workspaceId, id, site.url);
  } else {
    patchRun(workspaceId, id, "failed", {
      checking: false,
      check: outcome === "unknown" ? "unknown" : "pending",
    });
  }
};

// Closes a failure panel or a published toast. A publish in flight stays, and
// so does the background follow of one that may still finish. An earlier
// publish's answer held behind the closed run shows next, unless the panel is
// closing only to publish again (`republishing`): the answer then waits for
// how that run ends.
export const dismissPublishRun = (
  workspaceId: string,
  { republishing = false }: { republishing?: boolean } = {},
) => {
  if (getRun(workspaceId)?.phase === "publishing") return;
  setRun(workspaceId, null);
  if (!republishing) showHeldAnswer(workspaceId);
};

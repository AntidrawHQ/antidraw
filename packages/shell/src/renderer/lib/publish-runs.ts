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
      if (current) setRun(workspaceId, null);
      return error.code === "SIGNED_OUT" ? "signed-out" : "cancelled";
    }
    console.error("Publish failed:", error);
    if (current) setRun(workspaceId, { id, phase: "failed", error, checking: false, check: null });
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

// Closes a failure panel or a published toast. A publish in flight stays.
export const dismissPublishRun = (workspaceId: string) => {
  if (getRun(workspaceId)?.phase === "publishing") return;
  setRun(workspaceId, null);
};

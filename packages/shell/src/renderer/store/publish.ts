import { create } from "zustand";
import { publishWorkspace } from "@/renderer/lib/api";
import type { Failure, PublishState, StepKey } from "@/renderer/components/publish/shared";

// Each workspace's publish, from the account check to the link or a failure,
// as the publish panel shows it. Kept here rather than in PublishButton, so
// a run outlives the panel and the button. No run means the confirm view.

/** A run is never on the confirm view; `id` tells a newer run from an older one. */
export type PublishRun = PublishState & { step: StepKey | "done"; id: number };

type PublishStore = {
  runs: Record<string, PublishRun>;
};

export const usePublishStore = create<PublishStore>(() => ({ runs: {} }));

// The build's output can run long; the panel only needs its end.
const MAX_LOG_LINES = 500;

let lastId = 0;

const runOf = (workspaceId: string) => usePublishStore.getState().runs[workspaceId];

/** Changes the run, if it's still the one `id` started. */
const patch = (workspaceId: string, id: number, change: (run: PublishRun) => Partial<PublishRun>) =>
  usePublishStore.setState((s) => {
    const run = s.runs[workspaceId];
    if (run?.id !== id) return s;
    return { runs: { ...s.runs, [workspaceId]: { ...run, ...change(run) } } };
  });

export const isCurrentRun = (workspaceId: string, id: number) => runOf(workspaceId)?.id === id;

/** Running: started, and neither live nor failed. */
export const isRunning = (run: PublishRun | undefined) => !!run && run.step !== "done" && !run.failure;

/** Starts a run at the account check, replacing any before it. Answers its id. */
export const beginPublish = (workspaceId: string, site: PublishState["site"]) => {
  const id = ++lastId;
  usePublishStore.setState((s) => ({
    runs: { ...s.runs, [workspaceId]: { id, site, step: "account", meta: {}, log: [] } },
  }));
  return id;
};

/** Back to the confirm view. */
export const clearPublish = (workspaceId: string) =>
  usePublishStore.setState((s) => {
    if (!s.runs[workspaceId]) return s;
    const { [workspaceId]: _, ...runs } = s.runs;
    return { runs };
  });

export const setPublishMeta = (workspaceId: string, id: number, step: StepKey, text: string) =>
  patch(workspaceId, id, (run) => ({ meta: { ...run.meta, [step]: text } }));

/** Fails the step the run is on. */
export const failPublish = (workspaceId: string, id: number, failure: Omit<Failure, "step">) =>
  patch(workspaceId, id, (run) => ({ failure: { ...failure, step: run.step === "done" ? "live" : run.step } }));

export const setSentToAgent = (workspaceId: string, id: number, sent: boolean) =>
  patch(workspaceId, id, () => ({ sentToClaude: sent }));

/**
 * Runs main's publish for a begun run, as it goes. Resolves to how it ended:
 * live, failed (the run says why), signed out (for the sign-in panel), or
 * replaced by a newer run.
 */
export const runPublish = async (workspaceId: string, id: number) => {
  try {
    for await (const event of publishWorkspace(workspaceId)) {
      if (!isCurrentRun(workspaceId, id)) return "replaced" as const;
      switch (event.type) {
        case "step":
          patch(workspaceId, id, () => ({ step: event.step, log: [], failure: undefined }));
          break;
        case "log":
          patch(workspaceId, id, (run) => ({ log: [...run.log, event.line].slice(-MAX_LOG_LINES) }));
          break;
        case "meta":
          setPublishMeta(workspaceId, id, event.step, event.text);
          break;
        case "upload": {
          const { done, total, unchanged, file } = event;
          patch(workspaceId, id, () => ({ upload: { done, total, unchanged, file } }));
          break;
        }
        case "done":
          patch(workspaceId, id, (run) => ({ site: { ...run.site, url: event.url }, step: "done", upload: undefined }));
          return "done" as const;
        case "error": {
          if (event.code === "SIGNED_OUT") return "signed-out" as const;
          // The first line says what failed; the rest is the build's error.
          const [message = "", ...detail] = event.message.split("\n");
          failPublish(workspaceId, id, { kind: event.code, message, detail: detail.join("\n") || undefined });
          return "failed" as const;
        }
      }
    }
  } catch (error) {
    console.error("Publish stream failed:", error);
  }
  if (!isCurrentRun(workspaceId, id)) return "replaced" as const;
  failPublish(workspaceId, id, {
    kind: "SERVER_ERROR",
    message: "Lost touch with the publish before it finished. Try again.",
  });
  return "failed" as const;
};

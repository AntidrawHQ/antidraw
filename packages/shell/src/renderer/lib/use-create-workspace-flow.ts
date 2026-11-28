import { useRef, useState } from "react";
import type { CreateWorkspaceStatusCode, ForkStatus, Workspace } from "@/main/api";
import { useCreateWorkspace, useForkSite, WorkspaceEventError } from "@/renderer/lib/workspace-ops";

// A workspace being made, step by step, for a progress list to show
// (CreateWorkspaceProgress): creating one from the template, or forking one
// from a published site.

export type WorkspaceFlowStatus<Step extends string> = "idle" | Step | "done" | "error";

export type CreateWorkspaceStatus = WorkspaceFlowStatus<CreateWorkspaceStatusCode>;

type FlowEvent<Step extends string> =
  | { type: "status"; status: Step }
  | { type: "npm"; output: { type: "stdout" | "stderr"; data: string } | { type: "exit"; code: number | null } }
  | { type: "done" }
  | { type: "error"; error: { code: string; message: string } };

type WorkspaceFlowOptions = {
  onSuccess?: (workspace: Workspace) => void;
  onError?: (error: Error) => void;
};

const MAX_NPM_LINES = 200;

const useWorkspaceFlow = <Step extends string>(
  // Starts it, as a mutation's mutate does. The signal is `cancel()`'s.
  run: (
    input: string,
    onProgress: (event: FlowEvent<Step>) => void,
    callbacks: { onSuccess: (workspace: Workspace) => void; onError: (error: Error) => void },
    signal: AbortSignal,
  ) => void,
  isPending: boolean,
  firstStep: Step,
  options?: WorkspaceFlowOptions,
) => {
  const [status, setStatus] = useState<WorkspaceFlowStatus<Step>>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Main's code for it, when main said what went wrong.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [npmLines, setNpmLines] = useState<string[]>([]);
  // Which step was running when the error hit; drives the red X + retry row
  const [failedStep, setFailedStep] = useState<Step | null>(null);
  const lastStepRef = useRef<Step | null>(null);
  // npm output arrives in chunks that can end mid-line; hold the trailing
  // partial line until its remainder arrives
  const partialLineRef = useRef("");
  // The run under way's, for cancel() to stop it with.
  const abortRef = useRef<AbortController | null>(null);

  // Only the tail of the log is ever visible; cap the buffer so a long install
  // (hundreds of fetch lines) doesn't grow state and re-render cost unbounded
  const appendNpmLines = (lines: string[]) =>
    setNpmLines((prev) => [...prev, ...lines].slice(-MAX_NPM_LINES));

  const isCreating =
    status !== "idle" && status !== "done" && status !== "error";

  const start = (input: string) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    // A cancelled run's last words: nothing of it is shown any more.
    const live = () => !abort.signal.aborted;
    setErrorMessage(null);
    setErrorCode(null);
    setFailedStep(null);
    setNpmLines([]);
    partialLineRef.current = "";
    // Optimistic first step so retry swaps the error state out immediately
    // instead of flashing all-dimmed steps until the first SSE event lands
    setStatus(firstStep);
    lastStepRef.current = firstStep;
    run(
      input,
      (event) => {
        if (!live()) return;
        if (event.type === "status") {
          lastStepRef.current = event.status;
          setStatus(event.status);
          setNpmLines([]);
          partialLineRef.current = "";
        }
        if (event.type === "npm") {
          if (event.output.type === "exit") {
            // Flush whatever is still buffered without a trailing newline
            // (e.g. a spawn error message) so it isn't silently dropped
            const rest = partialLineRef.current.trim();
            partialLineRef.current = "";
            if (rest) appendNpmLines([rest]);
          } else {
            const chunks = (partialLineRef.current + event.output.data).split(
              "\n",
            );
            partialLineRef.current = chunks.pop() ?? "";
            const lines = chunks.map((line) => line.trim()).filter(Boolean);
            if (lines.length > 0) appendNpmLines(lines);
          }
        }
        if (event.type === "done") setStatus("done");
        if (event.type === "error") {
          setStatus("error");
          setErrorMessage(event.error.message);
          setErrorCode(event.error.code);
          setFailedStep(lastStepRef.current);
        }
      },
      {
        onSuccess: (workspace) => live() && options?.onSuccess?.(workspace),
        onError: (err) => {
          if (!live()) return;
          setStatus("error");
          setErrorMessage(err.message);
          setErrorCode(err instanceof WorkspaceEventError ? err.code : null);
          setFailedStep(lastStepRef.current);
          options?.onError?.(err);
        },
      },
      abort.signal,
    );
  };

  // Stops the run under way and goes back to idle, as reset() does.
  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    reset();
  };

  const reset = () => {
    setStatus("idle");
    setErrorMessage(null);
    setErrorCode(null);
    setNpmLines([]);
    setFailedStep(null);
    lastStepRef.current = null;
    partialLineRef.current = "";
  };

  return {
    status,
    errorMessage,
    errorCode,
    npmLines,
    failedStep,
    isCreating,
    isPending,
    start,
    reset,
    cancel,
  };
};

/** A new workspace from the template: `start(name)`. Main can't stop one, so there's no cancel. */
export const useCreateWorkspaceFlow = (options?: WorkspaceFlowOptions) => {
  const { mutate, isPending } = useCreateWorkspace();
  const { cancel: _, ...flow } = useWorkspaceFlow<CreateWorkspaceStatusCode>(
    (name, onProgress, callbacks) => mutate({ name, onProgress }, callbacks),
    isPending,
    "CREATING_DIRECTORY",
    options,
  );
  return flow;
};

/** A new workspace forked from a published site: `start(siteId)`, and `cancel()` to stop it. */
export const useForkSiteFlow = (options?: WorkspaceFlowOptions) => {
  const { mutate, isPending } = useForkSite();
  return useWorkspaceFlow<ForkStatus>(
    (siteId, onProgress, callbacks, signal) => mutate({ siteId, signal, onProgress }, callbacks),
    isPending,
    "FETCHING_SOURCE",
    options,
  );
};

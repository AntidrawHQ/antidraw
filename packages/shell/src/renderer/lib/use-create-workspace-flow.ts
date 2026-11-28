import { useEffect, useRef, useState } from "react";
import type { CreateWorkspaceStatusCode, ForkStatus, Workspace } from "@/main/api";
import { useCreateWorkspace, useForkSite } from "@/renderer/lib/workspace-ops";

// A workspace being made, step by step, for a progress list to show
// (CreateWorkspaceProgress): creating one from the template, or forking one
// from a published site.

export type WorkspaceFlowStatus<Step extends string> = "idle" | Step | "done" | "error";

export type CreateWorkspaceStatus = WorkspaceFlowStatus<CreateWorkspaceStatusCode>;

type FlowEvent<Step extends string> =
  | { type: "status"; status: Step }
  | { type: "npm"; output: { type: "stdout" | "stderr"; data: string } | { type: "exit"; code: number | null } }
  | { type: "done" }
  | { type: "error"; error: { message: string } };

type WorkspaceFlowOptions = {
  onSuccess?: (workspace: Workspace) => void;
  onError?: (error: Error) => void;
};

const MAX_NPM_LINES = 200;

const useWorkspaceFlow = <Step extends string>(
  // Starts it, as a mutation's mutate does.
  run: (
    input: string,
    onProgress: (event: FlowEvent<Step>) => void,
    callbacks: { onSuccess: (workspace: Workspace) => void; onError: (error: Error) => void },
  ) => void,
  isPending: boolean,
  firstStep: Step,
  options?: WorkspaceFlowOptions,
) => {
  const [status, setStatus] = useState<WorkspaceFlowStatus<Step>>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [npmLines, setNpmLines] = useState<string[]>([]);
  // Which step was running when the error hit; drives the red X + retry row
  const [failedStep, setFailedStep] = useState<Step | null>(null);
  const lastStepRef = useRef<Step | null>(null);
  // npm output arrives in chunks that can end mid-line; hold the trailing
  // partial line until its remainder arrives
  const partialLineRef = useRef("");

  // Only the tail of the log is ever visible; cap the buffer so a long install
  // (hundreds of fetch lines) doesn't grow state and re-render cost unbounded
  const appendNpmLines = (lines: string[]) =>
    setNpmLines((prev) => [...prev, ...lines].slice(-MAX_NPM_LINES));

  const isCreating =
    status !== "idle" && status !== "done" && status !== "error";

  const start = (input: string) => {
    setErrorMessage(null);
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
          setFailedStep(lastStepRef.current);
        }
      },
      {
        onSuccess: (workspace) => options?.onSuccess?.(workspace),
        onError: (err) => {
          setStatus("error");
          setErrorMessage(err.message);
          setFailedStep(lastStepRef.current);
          options?.onError?.(err);
        },
      },
    );
  };

  const reset = () => {
    setStatus("idle");
    setErrorMessage(null);
    setNpmLines([]);
    setFailedStep(null);
    lastStepRef.current = null;
    partialLineRef.current = "";
  };

  return {
    status,
    errorMessage,
    npmLines,
    failedStep,
    isCreating,
    isPending,
    start,
    reset,
  };
};

/** A new workspace from the template: `start(name)`. */
export const useCreateWorkspaceFlow = (options?: WorkspaceFlowOptions) => {
  const { mutate, isPending } = useCreateWorkspace();
  return useWorkspaceFlow<CreateWorkspaceStatusCode>(
    (name, onProgress, callbacks) => mutate({ name, onProgress }, callbacks),
    isPending,
    "CREATING_DIRECTORY",
    options,
  );
};

// How many forks are under way, from their start until the tab is the fork
// (or they've failed). While any is, nothing outside the user's hands may
// change what the tab holds (outside-agent.ts): the fork's outcome is told
// to the view that started it, and is lost if that view goes.
let forksUnderWay = 0;
export const forkUnderWay = () => forksUnderWay > 0;

/** A new workspace forked from a published site: `start(siteId)`. */
export const useForkSiteFlow = (options?: WorkspaceFlowOptions) => {
  const { mutate, isPending } = useForkSite();
  const flow = useWorkspaceFlow<ForkStatus>(
    (siteId, onProgress, callbacks) => mutate({ siteId, onProgress }, callbacks),
    isPending,
    "FETCHING_SOURCE",
    options,
  );
  const underWay = flow.status !== "idle" && flow.status !== "error";
  useEffect(() => {
    if (!underWay) return;
    forksUnderWay++;
    return () => void forksUnderWay--;
  }, [underWay]);
  return flow;
};

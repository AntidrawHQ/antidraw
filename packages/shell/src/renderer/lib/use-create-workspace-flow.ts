import { useRef, useState } from "react";
import type { Workspace, CreateWorkspaceStatusCode } from "@/main/api";
import { useCreateWorkspace } from "@/renderer/lib/workspace-ops";

export type CreateWorkspaceStatus =
  | "idle"
  | CreateWorkspaceStatusCode
  | "done"
  | "error";

type CreateWorkspaceFlowOptions = {
  onSuccess?: (workspace: Workspace) => void;
  onError?: (error: Error) => void;
};

const MAX_NPM_LINES = 200;

export const useCreateWorkspaceFlow = (
  options?: CreateWorkspaceFlowOptions,
) => {
  const [status, setStatus] = useState<CreateWorkspaceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [npmLines, setNpmLines] = useState<string[]>([]);
  // Which step was running when the error hit; drives the red X + retry row
  const [failedStep, setFailedStep] = useState<CreateWorkspaceStatusCode | null>(
    null,
  );
  const lastStepRef = useRef<CreateWorkspaceStatusCode | null>(null);
  // npm output arrives in chunks that can end mid-line; hold the trailing
  // partial line until its remainder arrives
  const partialLineRef = useRef("");
  const { mutate, isPending } = useCreateWorkspace();

  // Only the tail of the log is ever visible; cap the buffer so a long install
  // (hundreds of fetch lines) doesn't grow state and re-render cost unbounded
  const appendNpmLines = (lines: string[]) =>
    setNpmLines((prev) => [...prev, ...lines].slice(-MAX_NPM_LINES));

  const isCreating =
    status !== "idle" && status !== "done" && status !== "error";

  const start = (name: string) => {
    setErrorMessage(null);
    setFailedStep(null);
    setNpmLines([]);
    partialLineRef.current = "";
    // Optimistic first step so retry swaps the error state out immediately
    // instead of flashing all-dimmed steps until the first SSE event lands
    setStatus("CREATING_DIRECTORY");
    lastStepRef.current = "CREATING_DIRECTORY";
    mutate(
      {
        name,
        onProgress: (event) => {
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

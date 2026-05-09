import { useState } from "react";
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

export const useCreateWorkspaceFlow = (
  options?: CreateWorkspaceFlowOptions,
) => {
  const [status, setStatus] = useState<CreateWorkspaceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { mutate, isPending } = useCreateWorkspace();

  const isCreating =
    status !== "idle" && status !== "done" && status !== "error";

  const start = (name: string) => {
    setErrorMessage(null);
    mutate(
      {
        name,
        onProgress: (event) => {
          if (event.type === "status") setStatus(event.status);
          if (event.type === "done") setStatus("done");
          if (event.type === "error") {
            setStatus("error");
            setErrorMessage(event.error.message);
          }
        },
      },
      {
        onSuccess: (workspace) => options?.onSuccess?.(workspace),
        onError: (err) => {
          setStatus("error");
          setErrorMessage(err.message);
          options?.onError?.(err);
        },
      },
    );
  };

  const reset = () => {
    setStatus("idle");
    setErrorMessage(null);
  };

  return { status, errorMessage, isCreating, isPending, start, reset };
};

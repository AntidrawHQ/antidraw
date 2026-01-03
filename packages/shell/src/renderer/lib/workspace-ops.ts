import type {
  Workspace,
  CreateWorkspaceResponse,
  DevServerState,
  DevServerInfo,
} from "@/main/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  startDevServer,
  stopDevServer,
  getDevServerStatus,
} from "./api";

export const useWorkspaces = () => {
  return useQuery({
    queryKey: ["workspaces"] as const,
    queryFn: async () => {
      const result = await listWorkspaces();
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
  });
};

// workspaceId is string | null to allow unconditional hook calls (React rules of hooks).
// The query is disabled until workspaceId is truthy via `enabled: !!workspaceId`.
export const useWorkspace = (workspaceId: string | null) => {
  return useQuery({
    queryKey: ["workspace", workspaceId] as const,
    queryFn: async () => {
      const result = await getWorkspace(workspaceId!);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    enabled: !!workspaceId,
  });
};

export const useCreateWorkspace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      onProgress?: (event: CreateWorkspaceResponse) => void;
    }): Promise<Workspace> => {
      const { name, onProgress } = params;
      const stream = createWorkspace(name);

      let workspace: Workspace | undefined;

      for await (const event of stream) {
        onProgress?.(event);

        if (event.type === "error") {
          throw new Error(event.error.message);
        }

        if (event.type === "done") {
          workspace = event.workspace;
        }
      }

      if (!workspace) {
        throw new Error("Workspace creation completed without returning workspace");
      }

      return workspace;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
};

export const useDeleteWorkspace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const result = await deleteWorkspace(workspaceId);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return workspaceId;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.removeQueries({ queryKey: ["workspace", deletedId] });
    },
  });
};

// ============================================================================
// Dev Server Hooks
// ============================================================================

export const useStartDevServer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const result = await startDevServer(workspaceId);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["devServer", data.workspaceId], {
        ...data,
        running: true,
      } satisfies DevServerInfo);
    },
  });
};

export const useStopDevServer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const result = await stopDevServer(workspaceId);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return workspaceId;
    },
    onSuccess: (workspaceId) => {
      queryClient.removeQueries({ queryKey: ["devServer", workspaceId] });
    },
  });
};

export const useDevServerStatus = (workspaceId: string | null) => {
  return useQuery({
    queryKey: ["devServer", workspaceId] as const,
    queryFn: async () => {
      const result = await getDevServerStatus(workspaceId!);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    enabled: !!workspaceId,
  });
};
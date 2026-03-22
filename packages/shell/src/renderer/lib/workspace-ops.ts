import { useEffect, useRef } from "react";
import type {
  Workspace,
  CreateWorkspaceResponse,
  DevServerState,
  DevServerInfo,
} from "@/main/api";
import { useMutation, useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { queryKeys } from "./query-keys";
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
    queryKey: queryKeys.workspaces.all,
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
    queryKey: queryKeys.workspaces.detail(workspaceId),
    queryFn: workspaceId
      ? async () => {
          const result = await getWorkspace(workspaceId);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }
          return result.value;
        }
      : skipToken,
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
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
    onSuccess: async (deletedId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      queryClient.removeQueries({ queryKey: queryKeys.workspaces.detail(deletedId) });
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
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000), // exponential backoff: 2s, 4s, 8s (capped at 30s)
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.devServer.status(data.workspaceId), {
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
      queryClient.removeQueries({ queryKey: queryKeys.devServer.status(workspaceId) });
    },
  });
};

export const useDevServerStatus = (workspaceId: string | null) => {
  return useQuery({
    queryKey: queryKeys.devServer.status(workspaceId),
    queryFn: workspaceId
      ? async () => {
          const result = await getDevServerStatus(workspaceId);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }
          return result.value;
        }
      : skipToken,
  });
};

export const useAutoSelectWorkspace = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const { data: workspaces } = useWorkspaces();

  useEffect(() => {
    if (!activeWorkspaceId && workspaces?.length) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [activeWorkspaceId, workspaces, setActiveWorkspaceId]);
};

export const useAutoStartDevServer = (workspaceId: string | null) => {
  const { data: devServer, isPending: isStatusPending } = useDevServerStatus(workspaceId);
  const startDevServer = useStartDevServer();
  const attemptedRef = useRef<string | null>(null);

  // Reset attempt tracking when workspace changes, allowing fresh retries
  useEffect(() => {
    attemptedRef.current = null;
  }, [workspaceId]);

  useEffect(() => {
    if (
      !workspaceId ||
      isStatusPending ||
      devServer?.running ||
      attemptedRef.current === workspaceId
    ) {
      return;
    }

    attemptedRef.current = workspaceId;
    startDevServer.mutate(workspaceId);
  }, [workspaceId, devServer?.running, isStatusPending, startDevServer]);

  return {
    isStarting: startDevServer.isPending,
    startError: startDevServer.error,
  };
};

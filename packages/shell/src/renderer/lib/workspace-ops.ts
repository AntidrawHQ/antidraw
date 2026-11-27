import { useEffect, useRef } from "react";
import type {
  Workspace,
  CreateWorkspaceResponse,
  DevServerState,
  DevServerInfo,
  ForkSiteResponse,
  PublishedSite,
} from "@/main/api";
import { useMutation, useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { queryKeys } from "./query-keys";
import {
  createWorkspace,
  forkSite,
  getWorkspace,
  deleteWorkspace,
  startDevServer,
  stopDevServer,
  getDevServerStatus,
  setPreference,
} from "./api";
import { workspacesQueryOptions } from "./workspace-queries";
import { usePreference } from "./preference-ops";
import { flushThumbnail } from "./thumbnail";

export const useWorkspaces = () => {
  return useQuery(workspacesQueryOptions);
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

// The workspace a stream of create or fork events ends with, passing each
// event on as it comes.
const workspaceFrom = async <Event extends CreateWorkspaceResponse | ForkSiteResponse>(
  stream: AsyncGenerator<Event>,
  onProgress?: (event: Event) => void,
): Promise<Workspace> => {
  for await (const event of stream) {
    onProgress?.(event);
    if (event.type === "error") throw new Error(event.error.message);
    if (event.type === "done") return event.workspace;
  }
  throw new Error("Workspace creation completed without returning workspace");
};

export const useCreateWorkspace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { name: string; onProgress?: (event: CreateWorkspaceResponse) => void }) =>
      workspaceFrom(createWorkspace(params.name), params.onProgress),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
};

// A new workspace forked from one of the account's published sites.
export const useForkSite = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { siteId: string; onProgress?: (event: ForkSiteResponse) => void }) =>
      workspaceFrom(forkSite(params.siteId), params.onProgress),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
};

// Opens a workspace in the window's one tab, in place of what was there, and
// shows it.
export const useSwitchWorkspace = () => {
  const queryClient = useQueryClient();
  const stopDevServer = useStopDevServer();

  return async (nextWorkspaceId: string) => {
    const { setDashboardShown } = useWorkspaceStore.getState();
    if (nextWorkspaceId === useWorkspaceStore.getState().activeWorkspaceId) {
      // Already in the tab: back to it from the dashboard.
      setDashboardShown(false);
      return;
    }

    await flushLeftCanvas();

    // Read after the wait, not before: another open may have come first, and
    // it's that one's dev server to stop.
    const { activeWorkspaceId, setActiveWorkspaceId, setActiveConversationId } =
      useWorkspaceStore.getState();
    if (nextWorkspaceId === activeWorkspaceId) {
      setDashboardShown(false);
      return;
    }

    if (activeWorkspaceId) {
      stopDevServer.mutate(activeWorkspaceId, {
        onError: (error) => {
          console.error("Failed to stop dev server:", error);
        },
      });
    }

    setActiveWorkspaceId(nextWorkspaceId);
    setActiveConversationId(null);
    // In place of a published site, too.
    useWorkspaceStore.getState().setPublishedSite(null);
    setDashboardShown(false);

    // usePreference caches with staleTime: Infinity, so keep the cache in sync
    queryClient.setQueryData(
      queryKeys.preferences.byKey("activeWorkspaceId"),
      nextWorkspaceId,
    );
    void setPreference("activeWorkspaceId", nextWorkspaceId);
  };
};

// The canvas's thumbnail as it's left, while its dev server still serves its
// frames. Not under the dashboard: nothing can be taken while it covers the
// canvas (a wait would only run out the timeout).
const flushLeftCanvas = () =>
  useWorkspaceStore.getState().dashboardShown ? Promise.resolve() : flushThumbnail();

// The saved activeWorkspaceId of a window whose tab was closed: the next
// launch opens on the dashboard, not on a workspace.
const NO_WORKSPACE = "";

// Closes the tab's workspace, which leaves the dashboard.
export const useCloseWorkspace = () => {
  const queryClient = useQueryClient();
  const stopDevServer = useStopDevServer();

  return async () => {
    if (!useWorkspaceStore.getState().activeWorkspaceId) return;

    await flushLeftCanvas();

    // Read after the wait: the tab may have changed, or been closed, meanwhile.
    const { activeWorkspaceId, setActiveWorkspaceId, setActiveConversationId, setDashboardShown } =
      useWorkspaceStore.getState();
    if (!activeWorkspaceId) return;

    setDashboardShown(true);
    setActiveWorkspaceId(null);
    setActiveConversationId(null);

    queryClient.setQueryData(queryKeys.preferences.byKey("activeWorkspaceId"), NO_WORKSPACE);
    void setPreference("activeWorkspaceId", NO_WORKSPACE);

    // Resolves once it has stopped, for a caller about to delete its files.
    await stopDevServer.mutateAsync(activeWorkspaceId).catch((error) => {
      console.error("Failed to stop dev server:", error);
    });
  };
};

// Opens a published site in the window's one tab, view-only, in place of
// what was there. A workspace it replaces is closed as its tab's close button
// closes it: its dev server stops, and the next launch opens on the dashboard.
export const useOpenPublished = () => {
  const queryClient = useQueryClient();
  const stopDevServer = useStopDevServer();

  return async (site: PublishedSite) => {
    await flushLeftCanvas();

    const { activeWorkspaceId, setActiveWorkspaceId, setActiveConversationId, setPublishedSite, setDashboardShown } =
      useWorkspaceStore.getState();
    if (activeWorkspaceId) {
      stopDevServer.mutate(activeWorkspaceId, {
        onError: (error) => {
          console.error("Failed to stop dev server:", error);
        },
      });
      setActiveWorkspaceId(null);
      setActiveConversationId(null);
      queryClient.setQueryData(queryKeys.preferences.byKey("activeWorkspaceId"), NO_WORKSPACE);
      void setPreference("activeWorkspaceId", NO_WORKSPACE);
    }

    setPublishedSite(site);
    setDashboardShown(false);
  };
};

// Closes the tab's published site, which leaves the dashboard.
export const closePublished = () => {
  const { setPublishedSite, setDashboardShown } = useWorkspaceStore.getState();
  setDashboardShown(true);
  setPublishedSite(null);
};

// To the dashboard from the tab's workspace, which stays open under it, at
// once: a thumbnail still waiting to be taken isn't waited for (that held the
// click for up to half a second). It's kept while the dashboard covers the
// canvas and taken on the way back to it; opening another workspace from the
// dashboard instead drops it, and that thumbnail stays one change behind.
export const showDashboard = () => useWorkspaceStore.getState().setDashboardShown(true);

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

// What the window opens on: the workspace it had open last, or the dashboard
// if its tab was closed. Without either (the first launch after onboarding),
// the newest workspace. Once: a tab closed later stays closed.
export const useAutoSelectWorkspace = () => {
  const { data: workspaces } = useWorkspaces();
  const { data: savedId, isPending: isPrefPending } =
    usePreference("activeWorkspaceId");
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !workspaces || isPrefPending) return;
    restored.current = true;

    const { activeWorkspaceId, setActiveWorkspaceId, setDashboardShown } =
      useWorkspaceStore.getState();
    if (activeWorkspaceId) return;

    const saved = workspaces.find((ws) => ws.id === savedId);
    const target = saved ?? (savedId === NO_WORKSPACE ? undefined : workspaces[0]);
    if (!target) {
      setDashboardShown(true);
      return;
    }

    setActiveWorkspaceId(target.id);
    if (!saved) setPreference("activeWorkspaceId", target.id);
  }, [workspaces, savedId, isPrefPending]);
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

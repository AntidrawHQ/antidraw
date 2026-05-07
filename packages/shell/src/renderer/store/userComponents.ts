import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  skipToken,
  keepPreviousData,
} from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ComponentStreamEvent } from "@/main/api";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { queryKeys } from "@/renderer/lib/query-keys";
import { listComponents, getComponentSource } from "@/renderer/lib/api";

export const useUserComponents = (workspaceId: string | null) => {
  return useQuery({
    queryKey: queryKeys.userComponents.byWorkspace(workspaceId!),
    queryFn: workspaceId
      ? async () => {
          const result = await listComponents(workspaceId);

          if (result.isErr()) {
            throw new Error(result.error.message);
          }

          return result.value;
        }
      : skipToken,
  });
};

export const useUserComponentsWatcher = (workspaceId: string | null) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;

    const abort = new AbortController();

    fetchEventSource(
      `antidraw://app/api/workspaces/${workspaceId}/components/stream`,
      {
        signal: abort.signal,
        openWhenHidden: true,
        onmessage: (ev) => {
          const event = JSON.parse(ev.data) as ComponentStreamEvent;
          if (event.type === "changed") {
            queryClient.invalidateQueries({
              queryKey: queryKeys.userComponents.byWorkspace(workspaceId),
            });
          }
        },
        onerror: (error) => {
          console.error("[useUserComponentsWatcher]", error);
        },
      },
    ).catch(() => {
      // fetchEventSource rejects on abort; ignore.
    });

    return () => {
      abort.abort();
    };
  }, [workspaceId, queryClient]);
};

export const useComponentSource = (componentName: string | null) => {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useQuery({
    queryKey: queryKeys.userComponents.source(workspaceId!, componentName!),
    placeholderData: keepPreviousData,
    queryFn:
      workspaceId && componentName
        ? async () => {
            const result = await getComponentSource(workspaceId, componentName);

            if (result.isErr()) {
              throw new Error(result.error.message);
            }

            return result.value;
          }
        : skipToken,
  });
};

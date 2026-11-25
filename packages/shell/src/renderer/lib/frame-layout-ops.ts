import { useCallback } from "react";
import { useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { getFrameLayouts, saveFrameLayouts, type FrameLayoutData } from "./api";

export const useFrameLayouts = (workspaceId: string | null) => {
  return useQuery({
    queryKey: queryKeys.frameLayouts.byWorkspace(workspaceId),
    queryFn: workspaceId
      ? async () => {
          const result = await getFrameLayouts(workspaceId);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }
          return result.value;
        }
      : skipToken,
  });
};

// For the canvas's onLayoutsChange: where its frames are, saved, and kept for
// the canvas when it's next up (with the places of frames still to arrive: a
// paste's).
export const useSaveFrameLayouts = (workspaceId: string) => {
  const queryClient = useQueryClient();
  return useCallback(
    (layouts: Omit<FrameLayoutData, "workspaceId">[]) => {
      const there = new Set(layouts.map((l) => l.componentName));
      queryClient.setQueryData<FrameLayoutData[]>(queryKeys.frameLayouts.byWorkspace(workspaceId), (saved) => [
        ...layouts.map((l) => ({ ...l, workspaceId })),
        ...(saved ?? []).filter((l) => !there.has(l.componentName)),
      ]);
      void saveFrameLayouts(workspaceId, layouts); // fire-and-forget
    },
    [workspaceId, queryClient],
  );
};

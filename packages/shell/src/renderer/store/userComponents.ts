import { useQuery, skipToken, keepPreviousData } from "@tanstack/react-query";
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

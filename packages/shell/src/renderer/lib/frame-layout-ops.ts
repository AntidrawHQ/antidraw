import { useQuery, skipToken } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { getFrameLayouts } from "./api";

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

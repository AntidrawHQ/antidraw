import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMountEffect } from "@/renderer/hooks/use-mount-effect";
import { queryKeys } from "@/renderer/lib/query-keys";

// Version of a downloaded, ready-to-install app update (null if none).
// Held in the query cache so the toast and the titlebar reminder read one
// shared value instead of each keeping its own copy and its own subscription.
export const useUpdateStatus = () => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.update.status,
    queryFn: async () => {
      const { pendingVersion } = await window.electronAPI.getUpdateStatus();
      // A push that landed while this read was in flight is newer than its
      // answer; keep it. A version only ever replaces null, never the reverse.
      return pendingVersion ?? queryClient.getQueryData<string | null>(queryKeys.update.status) ?? null;
    },
    // Only ever changes via the push below.
    staleTime: Infinity,
  });

  return data ?? null;
};

// Registers the single "update-downloaded" subscription and writes straight
// into the cache. Mount once, at the root — the pull above covers the case
// where the download finishes before the renderer subscribes.
export const useUpdateSubscription = () => {
  const queryClient = useQueryClient();

  useMountEffect(() =>
    window.electronAPI.onUpdateDownloaded((version) => {
      queryClient.setQueryData(queryKeys.update.status, version);
    }),
  );
};

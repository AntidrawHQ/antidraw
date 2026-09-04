import { useState } from "react";
import { useMountEffect } from "@/renderer/hooks/use-mount-effect";

// Version of a downloaded, ready-to-install app update (null if none).
// Pulls current status on mount — the download can finish before the
// renderer subscribes — then listens for the push event.
export const useUpdateStatus = () => {
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);

  useMountEffect(() => {
    window.electronAPI.getUpdateStatus().then((status) => {
      if (status.pendingVersion) {
        setPendingVersion(status.pendingVersion);
      }
    });
    return window.electronAPI.onUpdateDownloaded(setPendingVersion);
  });

  return pendingVersion;
};

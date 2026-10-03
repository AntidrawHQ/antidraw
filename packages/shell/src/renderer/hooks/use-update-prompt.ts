import { useEffect } from "react";
import { toast } from "sonner";
import {
  showUpdateToast,
  UPDATE_TOAST_ID,
} from "@/renderer/components/UpdateToast";
import { useUpdateStatus } from "@/renderer/hooks/use-update-status";
import { useUpdateStore } from "@/renderer/store/update";

// Which half of the update prompt is showing. The toast is up until the user
// picks "Later", after which the titlebar reminder is the way back to it.
export const useUpdatePrompt = () => {
  const pendingVersion = useUpdateStatus();
  const dismissedVersion = useUpdateStore((state) => state.dismissedVersion);

  const isDismissed = dismissedVersion === pendingVersion;

  return {
    pendingVersion,
    showToast: pendingVersion !== null && !isDismissed,
    showReminder: pendingVersion !== null && isDismissed,
  };
};

// Drives the sonner toast off that state. Mount once, at the root.
export const useUpdateToast = () => {
  const { pendingVersion, showToast } = useUpdatePrompt();
  const dismissVersion = useUpdateStore((state) => state.dismissVersion);

  useEffect(() => {
    if (!showToast || pendingVersion === null) return;

    showUpdateToast({
      version: pendingVersion,
      onRestart: () => void window.electronAPI.installUpdate(),
      onDismiss: () => dismissVersion(pendingVersion),
    });

    return () => {
      toast.dismiss(UPDATE_TOAST_ID);
    };
  }, [showToast, pendingVersion, dismissVersion]);
};

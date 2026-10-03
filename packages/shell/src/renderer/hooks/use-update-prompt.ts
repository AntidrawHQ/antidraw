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

  // A newer version arriving while the toast is up updates it in place, under
  // the same id.
  useEffect(() => {
    if (!showToast || pendingVersion === null) return;

    showUpdateToast({
      version: pendingVersion,
      onRestart: () => void window.electronAPI.installUpdate(),
      onDismiss: () => dismissVersion(pendingVersion),
    });
  }, [showToast, pendingVersion, dismissVersion]);

  // Hidden only when the toast should go away, not on every version change:
  // sonner applies a dismiss a frame later, so dismissing and re-showing under
  // the same id in one pass would delete the re-shown toast.
  useEffect(() => {
    if (!showToast) return;
    return () => {
      toast.dismiss(UPDATE_TOAST_ID);
    };
  }, [showToast]);
};

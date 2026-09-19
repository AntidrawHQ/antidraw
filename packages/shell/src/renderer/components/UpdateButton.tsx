import { RefreshCw } from "lucide-react";
import { useUpdateStatus } from "@/renderer/hooks/use-update-status";

// Shown once an app update has been downloaded and is ready to install.
// Clicking restarts the app into the new version (autoUpdater.quitAndInstall).
export const UpdateButton = () => {
  const pendingVersion = useUpdateStatus();

  if (!pendingVersion) return null;

  return (
    <button
      title={`Version ${pendingVersion} has been downloaded`}
      onClick={() => void window.electronAPI.installUpdate()}
      className="flex items-center gap-1.5 py-1 px-2.5 border-none rounded-lg cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[12px] font-medium whitespace-nowrap transition-colors"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <RefreshCw className="w-3 h-3" />
      Restart to update
    </button>
  );
};

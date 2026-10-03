import { UpdateReminder } from "@/renderer/components/UpdateReminder";
import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";
import { useUpdatePrompt } from "@/renderer/hooks/use-update-prompt";
import { useUpdateStore } from "@/renderer/store/update";

export const TITLEBAR_HEIGHT = 38;

export const Titlebar = () => {
  const { pendingVersion, showReminder } = useUpdatePrompt();
  const clearDismissal = useUpdateStore((state) => state.clearDismissal);

  return (
    <div className="h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d] drag-region">
      <div className="min-w-[180px] shrink-0 flex items-center gap-2">
        {/* Clears the macOS traffic lights. */}
        <div className="w-[78px] shrink-0" />
        {showReminder && pendingVersion && (
          <UpdateReminder version={pendingVersion} onClick={clearDismissal} />
        )}
      </div>
      <span className="flex-1 text-center text-[13px] font-medium text-neutral-400">
        AntiDraw
      </span>
      <div className="min-w-[180px] shrink-0 flex items-center justify-end gap-2 pr-2 relative">
        <WorkspaceSwitcher />
      </div>
    </div>
  );
};

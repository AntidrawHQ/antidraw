import { UpdateButton } from "@/renderer/components/UpdateButton";
import { UpdateReminder } from "@/renderer/components/UpdateReminder";
import { showUpdateToast } from "@/renderer/components/UpdateToast";
import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";

export const TITLEBAR_HEIGHT = 38;

const PREVIEW_VERSION = "0.0.14-alpha";

export const Titlebar = () => (
  <div
    className="h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d] drag-region"
  >
    <div className="min-w-[180px] shrink-0 flex items-center gap-2">
      {/* Clears the macOS traffic lights. */}
      <div className="w-[78px] shrink-0" />
      {/* TODO: preview-only — always visible so the design can be eyeballed.
          Should render only once the toast has been dismissed. */}
      <UpdateReminder
        version={PREVIEW_VERSION}
        onClick={() => showUpdateToast({ version: PREVIEW_VERSION })}
      />
    </div>
    <span className="flex-1 text-center text-[13px] font-medium text-neutral-400">
      AntiDraw
    </span>
    <div className="min-w-[180px] shrink-0 flex items-center justify-end gap-2 pr-2 relative">
      <UpdateButton />
      <WorkspaceSwitcher />
    </div>
  </div>
);

import { UpdateButton } from "@/renderer/components/UpdateButton";
import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";

export const TITLEBAR_HEIGHT = 38;

export const Titlebar = () => (
  <div
    className="h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d] drag-region"
  >
    <div className="w-[180px] shrink-0" />
    <span className="flex-1 text-center text-[13px] font-medium text-neutral-400">
      AntiDraw
    </span>
    <div className="min-w-[180px] shrink-0 flex items-center justify-end gap-2 pr-2 relative">
      <UpdateButton />
      <WorkspaceSwitcher />
    </div>
  </div>
);

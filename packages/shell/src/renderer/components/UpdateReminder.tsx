import type { CSSProperties } from "react";
import { WorkspaceAvatar } from "@/renderer/components/UpdateToast";

// Persistent titlebar reminder that an update is waiting. Shown once the user
// dismisses the update toast (X or "Later") so the prompt is recoverable —
// clicking brings the toast back.

type UpdateReminderProps = {
  version: string;
  onClick: () => void;
};

export const UpdateReminder = ({ version, onClick }: UpdateReminderProps) => (
  <button
    onClick={onClick}
    title={`Version ${version} has been downloaded`}
    className="flex items-center gap-1.5 rounded-lg border-none bg-white/[0.06] py-1 pl-1 pr-2 text-[13px] font-medium text-neutral-200 cursor-pointer transition-colors hover:bg-white/[0.10]"
    style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
  >
    <WorkspaceAvatar seed={version} size={16} />
    Update available
  </button>
);

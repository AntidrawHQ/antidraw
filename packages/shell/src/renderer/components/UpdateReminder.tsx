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
    className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.04] py-1 pl-1 pr-2 text-[13px] font-medium text-neutral-400 cursor-pointer transition-colors hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-neutral-200"
    style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
  >
    <WorkspaceAvatar seed={version} size={16} />
    Update available
  </button>
);

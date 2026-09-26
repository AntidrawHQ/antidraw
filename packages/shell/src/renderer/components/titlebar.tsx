import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";
import { PublishButton } from "@/renderer/components/PublishButton";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useWorkspaces } from "@/renderer/lib/workspace-ops";

export const TITLEBAR_HEIGHT = 38;

export const Titlebar = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: workspaces } = useWorkspaces();
  const activeWorkspace = workspaces?.find((ws) => ws.id === activeWorkspaceId);

  return (
    <div
      className="relative h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d] drag-region"
    >
      {/* Centered on the window, not between the side groups, which differ in width */}
      <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium text-neutral-400">
        AntiDraw
      </span>
      <div className="ml-auto flex items-center gap-2 pr-2 relative">
        <WorkspaceSwitcher />
        {activeWorkspace && (
          <PublishButton
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.name}
          />
        )}
      </div>
    </div>
  );
};

import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";
import { PublishButton } from "@/renderer/components/PublishButton";
import { UpdateReminder } from "@/renderer/components/UpdateReminder";
import { useUpdatePrompt } from "@/renderer/hooks/use-update-prompt";
import { useUpdateStore } from "@/renderer/store/update";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useWorkspaces } from "@/renderer/lib/workspace-ops";

export const TITLEBAR_HEIGHT = 38;

export const Titlebar = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: workspaces } = useWorkspaces();
  const activeWorkspace = workspaces?.find((ws) => ws.id === activeWorkspaceId);
  const { pendingVersion, showReminder } = useUpdatePrompt();
  const clearDismissal = useUpdateStore((state) => state.clearDismissal);

  return (
    <div
      // pl-20 keeps the titlebar's contents clear of the traffic lights.
      className="relative h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#333] drag-region pl-20"
    >
      {/* Centered on the window, not between the side groups, which differ in
          width. Hidden where the right-hand group would cover it. */}
      <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium text-neutral-400 max-[720px]:hidden">
        Antidraw
      </span>
      {/* Shown once the update toast is dismissed; clicking brings it back. */}
      {showReminder && pendingVersion && (
        <UpdateReminder version={pendingVersion} onClick={clearDismissal} />
      )}
      <div className="ml-auto flex min-w-0 items-center gap-2 pr-2 relative">
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

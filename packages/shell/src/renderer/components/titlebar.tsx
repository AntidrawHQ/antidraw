import { useState, type CSSProperties, type ReactNode } from "react";
import { McpSetup } from "@/renderer/components/McpSetup";
import { PublishButton } from "@/renderer/components/PublishButton";
import { UpdateReminder } from "@/renderer/components/UpdateReminder";
import { Svg, WorkspaceThumb, ic } from "@/renderer/dashboard/kit";
import { useUpdatePrompt } from "@/renderer/hooks/use-update-prompt";
import { useUpdateStore } from "@/renderer/store/update";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { showDashboard, useCloseWorkspace, useWorkspaces } from "@/renderer/lib/workspace-ops";
import { cn } from "@/renderer/lib/utils";

// main.ts centres the traffic lights in it (trafficLightPosition).
export const TITLEBAR_HEIGHT = 46;

const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

// One of the window's tabs. Not a <button>: the workspace's holds its close
// button.
const Tab = ({
  on,
  onSelect,
  className,
  children,
}: {
  on: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) => (
  <div
    role="tab"
    aria-selected={on}
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) onSelect();
    }}
    style={NO_DRAG}
    className={cn(
      "group flex h-[30px] cursor-default items-center gap-2 rounded-[8px] pr-2 pl-2.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-[#7F8BE0]",
      on ? "bg-[#373737] text-[#EBEBEB]" : "text-[#B2B2B2] hover:bg-[#313131]",
      className,
    )}
  >
    {children}
  </div>
);

// The main window's titlebar: its two tabs, the Dashboard and the one
// workspace that's open, then what's for that workspace (the MCP setup,
// Publish).
export const Titlebar = ({ tabs = true }: { tabs?: boolean }) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const dashboardShown = useWorkspaceStore((s) => s.dashboardShown);
  const setDashboardShown = useWorkspaceStore((s) => s.setDashboardShown);
  const { data: workspaces } = useWorkspaces();
  const activeWorkspace = workspaces?.find((ws) => ws.id === activeWorkspaceId);
  // The last workspace in the tab, kept after it's closed: a publish of it
  // under way keeps its button, and shows its result.
  const [lastWorkspace, setLastWorkspace] = useState(activeWorkspace);
  if (activeWorkspace && activeWorkspace !== lastWorkspace) setLastWorkspace(activeWorkspace);
  const closeWorkspace = useCloseWorkspace();
  const { pendingVersion, showReminder } = useUpdatePrompt();
  const clearDismissal = useUpdateStore((state) => state.clearDismissal);

  return (
    <div
      // pl-[76px] keeps the tabs clear of the traffic lights. The rule is the
      // workspace view's: the dashboard is a darker grey than the bar already.
      className={cn(
        "relative flex h-[46px] w-full shrink-0 items-center gap-1.5 bg-[#2A2A2A] pr-2 pl-[76px] font-sans antialiased drag-region",
        !dashboardShown && "border-b border-[#333]",
      )}
    >
      {tabs && (
        // Clipped across, in a window too narrow for them: drawn under the
        // right-hand controls, the close button would take their clicks.
        <div role="tablist" className="flex min-w-0 items-center gap-1.5 overflow-x-clip">
          <Tab on={dashboardShown} onSelect={() => void showDashboard()} className="shrink-0">
            <Svg size={14}>{ic.grid}</Svg>
            <span>Dashboard</span>
          </Tab>
          {activeWorkspace && (
            <Tab on={!dashboardShown} onSelect={() => setDashboardShown(false)} className="min-w-0">
              {/* Gone in a narrow window, for the close button's room. */}
              <WorkspaceThumb workspace={activeWorkspace} className="h-[14px] w-[20px] shrink-0 rounded-[3px] max-[640px]:hidden" />
              <span className="max-w-[180px] truncate">{activeWorkspace.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void closeWorkspace();
                }}
                aria-label="Close tab"
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded text-[#B2B2B2] hover:text-[#E9E9E9] focus-visible:opacity-100",
                  !dashboardShown ? "" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <Svg size={11} sw={2}>
                  {ic.close}
                </Svg>
              </button>
            </Tab>
          )}
        </div>
      )}
      <div className="relative ml-auto flex min-w-0 shrink-0 items-center gap-2">
        {/* Shown once the update toast is dismissed; clicking brings it back. */}
        {showReminder && pendingVersion && (
          <UpdateReminder version={pendingVersion} onClick={clearDismissal} />
        )}
        {/* For the open workspace's canvas, so only while it's the tab
            showing. Hidden rather than unmounted, also once its tab is
            closed: a publish under way keeps its place. */}
        {lastWorkspace && (
          <div className={cn("flex items-center gap-2", (dashboardShown || !activeWorkspace) && "hidden")}>
            <McpSetup />
            <PublishButton
              workspaceId={lastWorkspace.id}
              workspaceName={lastWorkspace.name}
              hidden={dashboardShown || !activeWorkspace}
            />
          </div>
        )}
      </div>
    </div>
  );
};

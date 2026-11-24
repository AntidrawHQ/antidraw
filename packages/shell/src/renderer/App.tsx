import { AppCanvas } from "./Canvas";
import { IconStrip } from "./IconStrip";
import { SidePanel } from "./SidePanel";
import { useAutoSelectWorkspace } from "@/renderer/lib/workspace-ops";
import { useConversationSubscription } from "@/renderer/lib/claude-code-ops";
import { useOutsideAgent } from "@/renderer/lib/outside-agent";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { Dashboard } from "@/renderer/dashboard/Dashboard";
import { PublishedViewer } from "@/renderer/published/PublishedViewer";

const App = () => {
  useAutoSelectWorkspace();
  // What agents outside the app see of the canvas, and their asks of it.
  useOutsideAgent();
  // Held here rather than in the chat panel: the panel unmounts on gestures
  // that leave the conversation open.
  useConversationSubscription();

  const dashboardShown = useWorkspaceStore((s) => s.dashboardShown);
  const publishedSite = useWorkspaceStore((s) => s.publishedSite);

  // The dashboard is drawn over what the other tab holds rather than in its
  // place: a workspace keeps its chat's stream and its frames, a published
  // site its frames, and either is there at once when its tab is picked
  // again. Inert meanwhile, so focus and clicks stay in the dashboard; and a
  // stacking context of its own, so nothing in it that's raised (a z-index)
  // is drawn over the dashboard.
  return (
    <div className="relative h-full">
      {publishedSite ? (
        // In the workspace view's place: with a site in the tab, no workspace
        // is open.
        <div className="isolate h-full overflow-hidden" inert={dashboardShown}>
          <PublishedViewer site={publishedSite} />
        </div>
      ) : (
        <div className="isolate flex h-full overflow-hidden" inert={dashboardShown}>
          <IconStrip />
          <SidePanel />
          <AppCanvas className="flex-1 border-l border-[#333]" />
        </div>
      )}
      {dashboardShown && <Dashboard />}
    </div>
  );
};

export default App;

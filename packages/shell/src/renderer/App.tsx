import { AppCanvas } from "./Canvas";
import { IconStrip } from "./IconStrip";
import { SidePanel } from "./SidePanel";
import { useAutoSelectWorkspace } from "@/renderer/lib/workspace-ops";
import { useConversationSubscription } from "@/renderer/lib/claude-code-ops";
import { CodeSidePanel } from "./components/CodeSidePanel";

const App = () => {
  useAutoSelectWorkspace();
  // Held here rather than in the chat panel: the panel unmounts on gestures
  // that leave the conversation open.
  useConversationSubscription();

  return (
    <div className="flex h-full overflow-hidden">
      <IconStrip />
      <SidePanel />
      <AppCanvas className="flex-1 border-l border-[#2d2d2d]" />
      <CodeSidePanel />
    </div>
  );
};

export default App;

import { AppCanvas } from "./Canvas";
import { IconStrip } from "./IconStrip";
import { SidePanel } from "./SidePanel";
import { useAutoSelectWorkspace } from "@/renderer/lib/workspace-ops";
import { CodeModal } from "./components/CodeModal";

const App = () => {
  useAutoSelectWorkspace();

  return (
    <div className="flex h-full overflow-hidden">
      <IconStrip />
      <SidePanel />
      <AppCanvas className="flex-1 border-l border-[#2d2d2d]" />
      <CodeModal />
    </div>
  );
};

export default App;

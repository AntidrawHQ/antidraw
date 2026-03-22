import { AppCanvas } from "./Canvas";
import { IconStrip } from "./IconStrip";
import { SidePanel } from "./SidePanel";
import { useAutoSelectWorkspace } from "@/renderer/lib/workspace-ops";

const App = () => {
  useAutoSelectWorkspace();

  return (
    <>
      <IconStrip />
      <SidePanel />
      <AppCanvas className="flex-1 border-l border-[#2d2d2d]" />
    </>
  );
};

export default App;

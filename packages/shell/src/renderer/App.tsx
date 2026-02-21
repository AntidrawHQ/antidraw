import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppCanvas } from "./Canvas";
import { IconStrip } from "./IconStrip";
import { SidePanel } from "./SidePanel";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-full flex-col">
        {/* Draggable titlebar */}
        <div
          className="h-[38px] flex items-center justify-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <span className="text-center text-[13px] font-medium text-neutral-400 tracking-tight">
            AntiDraw
          </span>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          <IconStrip />
          <SidePanel />
          <AppCanvas className="flex-1 border-l border-[#2d2d2d]" />
        </div>
      </div>
    </QueryClientProvider>
  );
}

export default App;

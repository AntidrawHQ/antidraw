import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppCanvas } from "./Canvas";
import { Sidebar } from "./Sidebar";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-full flex-col">
        {/* Draggable titlebar */}
        <div
          className="h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          {/* Left spacer — balances the right side so "AntiDraw" stays centered */}
          <div className="w-[180px] shrink-0" />

          <span className="flex-1 text-center text-[13px] font-medium text-neutral-400 tracking-tight">
            AntiDraw
          </span>

          {/* Right side — workspace switcher */}
          <div className="w-[180px] shrink-0 flex justify-end pr-2 relative">
            <WorkspaceSwitcher />
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <AppCanvas className="flex-1 border-l border-[#2d2d2d]" />
        </div>
      </div>
    </QueryClientProvider>
  );
}

export default App;

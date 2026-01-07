import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppCanvas } from "./Canvas";
import { Sidebar } from "./Sidebar";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-full flex-col">
        {/* Draggable titlebar */}
        <div
          className="h-8 flex items-center justify-center w-full shrink-0 bg-neutral-800"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <span className="text-center text-xs text-neutral-400">antidraw</span>
        </div>

        {/* Main content */}
        <div className="relative flex-1 overflow-hidden">
          <AppCanvas className="absolute inset-0" />
          <Sidebar className="absolute left-0 top-0 h-full z-10" />
        </div>
      </div>
    </QueryClientProvider>
  );
}

export default App;

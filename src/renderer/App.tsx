import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppCanvas } from "./Canvas";
import { AppChat } from "./Chat";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-full flex-col">
        {/* Draggable titlebar */}
        <div
          className="h-8 w-full shrink-0 bg-neutral-800"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          <AppChat className="basis-2/5 min-w-sm" />
          <AppCanvas />
        </div>
      </div>
    </QueryClientProvider>
  );
}

export default App;

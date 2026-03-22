import {
  createRootRouteWithContext,
  Outlet,
  useRouteContext,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";

type RouterContext = {
  queryClient: QueryClient;
};

const RootComponent = () => {
  const { queryClient } = useRouteContext({ from: "__root__" });

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex h-screen w-full flex-col">
          {/* Draggable titlebar */}
          <div
            className="h-[38px] w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />

          <div className="flex-1 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

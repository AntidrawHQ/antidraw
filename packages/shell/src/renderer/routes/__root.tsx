import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ClaudeAuthStatus } from "@/renderer/lib/auth";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";
import { Titlebar } from "@/renderer/components/ui/titlebar";

type RouterContext = {
  queryClient: QueryClient;
  claudeCodeAuth: ClaudeAuthStatus;
};

const RootComponent = () => {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-full flex-col">
        <Titlebar />

        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

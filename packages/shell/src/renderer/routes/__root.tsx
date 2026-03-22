import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";

type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

const RootComponent = () => {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex h-screen w-full flex-col">
          <Outlet />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

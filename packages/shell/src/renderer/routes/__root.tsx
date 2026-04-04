import {
  createRootRouteWithContext,
  Outlet,
  useLocation,
  useRouteContext,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";
import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";

type RouterContext = {
  queryClient: QueryClient;
};

const RootComponent = () => {
  const { queryClient } = useRouteContext({ from: "__root__" });
  const pathname = useLocation({ select: (l) => l.pathname });
  const showWorkspaceTitlebar =
    !pathname.startsWith("/onboarding") && pathname !== "/login";

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex h-screen w-full flex-col">
          {showWorkspaceTitlebar ? (
            <div
              className="h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
              style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
              <div className="w-[180px] shrink-0" />
              <span className="flex-1 text-center text-[13px] font-medium text-neutral-400">
                AntiDraw
              </span>
              <div className="w-[180px] shrink-0 flex justify-end pr-2 relative">
                <WorkspaceSwitcher />
              </div>
            </div>
          ) : (
            <div
              className="h-[38px] w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
              style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            />
          )}

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

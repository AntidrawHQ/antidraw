import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";
import { Titlebar } from "@/renderer/components/titlebar";
import { useUpdateSubscription } from "@/renderer/hooks/use-update-status";
import { useUpdateToast } from "@/renderer/hooks/use-update-prompt";

type RouterContext = {
  queryClient: QueryClient;
};

const RootComponent = () => {
  // Single "update-downloaded" subscription for the app, plus the toast it drives.
  useUpdateSubscription();
  useUpdateToast();

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full flex-col">
        <Titlebar />

        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>

        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            // Strip sonner's default card styling so our custom card owns the look.
            unstyled: true,
          }}
        />
      </div>
    </TooltipProvider>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

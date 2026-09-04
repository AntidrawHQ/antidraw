import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";
import { Titlebar } from "@/renderer/components/titlebar";
import { showUpdateToast } from "@/renderer/components/UpdateToast";
import { useMountEffect } from "@/renderer/hooks/use-mount-effect";

type RouterContext = {
  queryClient: QueryClient;
};

const RootComponent = () => {
  // TODO: preview-only — fires the update toast on every launch so the design
  // can be eyeballed. Remove once the toast is driven by real update status.
  useMountEffect(() => {
    const id = showUpdateToast({ version: "0.0.14-alpha" });
    return () => toast.dismiss(id);
  });

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

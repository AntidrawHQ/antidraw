import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

type RouterContext = {
  queryClient: QueryClient;
};

// Every window's: each draws its own chrome. The main window's is _main's;
// a frame's own window's is /preview's.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});

import { createRootRouteWithContext, Navigate, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

type RouterContext = {
  queryClient: QueryClient;
};

// Every window's: each draws its own chrome. The main window's is _main's;
// a frame's own window's is /preview's.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  // A path no page has (a markdown link's #fragment, say) matches only the
  // root, outside any window's chrome: back to the app rather than a bare
  // "Not Found" with no titlebar to drag.
  notFoundComponent: () => <Navigate to="/" replace />,
});

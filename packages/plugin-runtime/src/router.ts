import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router"
import { Canvas } from "./pages/Canvas"
import { Preview } from "./pages/Preview"

const rootRoute = createRootRoute()

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Canvas,
})

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preview",
  component: Preview,
  validateSearch: (search: Record<string, unknown>) => ({
    componentName: (search.componentName as string) || undefined,
  }),
})

const routeTree = rootRoute.addChildren([indexRoute, previewRoute])

export const router = createRouter({ routeTree })

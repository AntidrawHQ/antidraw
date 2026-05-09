import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router"
import { Preview } from "./pages/Preview"

const rootRoute = createRootRoute()

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preview",
  component: Preview,
  validateSearch: (search: Record<string, unknown>) => ({
    componentName: (search.componentName) || undefined,
    fullscreen: search.fullscreen === "true" || search.fullscreen === true,
  }),
})

const routeTree = rootRoute.addChildren([previewRoute])

export const router = createRouter({ routeTree })

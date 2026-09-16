import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router"
import { Preview } from "./pages/Preview"

const rootRoute = createRootRoute()

// Component names are interpolated into a module URL by the Preview page, so
// only plain file-name characters are accepted; anything else previews nothing.
const COMPONENT_NAME_RE = /^[\w-]+$/

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preview",
  component: Preview,
  validateSearch: (search: Record<string, unknown>) => {
    // The search parser turns "404" into a number; keep it a name.
    const name = search.componentName == null ? "" : String(search.componentName)
    return {
      componentName: COMPONENT_NAME_RE.test(name) ? name : undefined,
      fullscreen: search.fullscreen === "true" || search.fullscreen === true,
    }
  },
})

const routeTree = rootRoute.addChildren([previewRoute])

export const router = createRouter({ routeTree })

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
  validateSearch: (search: Record<string, unknown>) => {
    // The search decoder turns "404", "true" and "false" into a number or a
    // boolean before any parser runs (router-core's qss toValue), and only
    // strings that round-trip exactly are converted, so String() restores
    // the name as written. Validity is decided by the Preview page, which
    // can say why a name is unusable.
    const name = search.componentName == null ? "" : String(search.componentName)
    return {
      componentName: name || undefined,
      fullscreen: search.fullscreen === "true" || search.fullscreen === true,
    }
  },
})

const routeTree = rootRoute.addChildren([previewRoute])

export const router = createRouter({ routeTree })

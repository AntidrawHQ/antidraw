import {
  createRouter,
  createRootRoute,
  createRoute,
  parseSearchWith,
  stringifySearchWith,
} from "@tanstack/react-router"
import { Preview } from "./pages/Preview"

const rootRoute = createRootRoute()

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preview",
  component: Preview,
  validateSearch: (search: Record<string, unknown>) => {
    const name = typeof search.componentName === "string" ? search.componentName : ""
    return {
      // Validated by the Preview page, which can say why a name is unusable.
      componentName: name || undefined,
      fullscreen: search.fullscreen === "true" || search.fullscreen === true,
    }
  },
})

const routeTree = rootRoute.addChildren([previewRoute])

export const router = createRouter({
  routeTree,
  // Keep search values as the strings the URL carries. The default parser
  // JSON-parses each value, which turns a component named "404", "true" or
  // "null" into a number, a boolean or null.
  parseSearch: parseSearchWith((value) => value),
  stringifySearch: stringifySearchWith(String),
})

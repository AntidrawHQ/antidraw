import { defineConfig } from "vitest/config";
import path from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  // Writes routeTree.gen.ts (gitignored) before the tests that load the app's routes.
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: path.resolve(__dirname, "./src/renderer/routes"),
      generatedRouteTree: path.resolve(__dirname, "./src/renderer/routeTree.gen.ts"),
      disableLogging: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});

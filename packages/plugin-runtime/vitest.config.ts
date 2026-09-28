import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Tests run the plugin as workspaces get it: dist/plugin.js, built first.
    globalSetup: ["./test/build-plugin.ts"],
    // Each test runs a real Vite build.
    testTimeout: 60_000,
  },
})

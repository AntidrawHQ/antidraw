import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Tests run the plugin as workspaces get it: dist/plugin.js, built first.
    globalSetup: ["./test/build-plugin.ts"],
    // The builds read plugin.ts (through dist/) and src/ from disk, outside
    // the tests' module graph, so editing them reruns nothing by default.
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/plugin.ts", "**/src/**"],
    // Each test runs a real Vite build.
    testTimeout: 60_000,
  },
})

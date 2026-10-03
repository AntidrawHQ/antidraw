import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The Worker serves the built app (dist/), so it's built first.
    globalSetup: ["./test/build-app.ts"],
    testTimeout: 30_000,
  },
});

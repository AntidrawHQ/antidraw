// Unit tests in plain Node: the Worker only needs the fetch API types
// (Request, Response, Headers), which Node has, and an R2 bucket, which the
// tests stand in for with test/memory-r2.ts. Run with `npx vitest run` from
// this directory (vitest resolves from the root node_modules).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

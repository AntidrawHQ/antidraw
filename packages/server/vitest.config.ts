import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // A Workers built-in; Node can't resolve it. See the stub for details.
      "cloudflare:workers": fileURLToPath(
        new URL("./src/test/cloudflare-workers.stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});

import { defineConfig } from "drizzle-kit";
import os from "node:os";
import path from "node:path";

// All paths are relative to project root (where you run drizzle-kit from)
export default defineConfig({
  schema: "./src/main/api/schema.ts",
  out: "./src/main/db/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${path.join(os.homedir(), ".antidraw", "antidraw.db")}`,
  },
});

import { defineConfig } from "drizzle-kit";

// All paths are relative to project root (where you run drizzle-kit from)
export default defineConfig({
  schema: "./src/main/api/schema.ts",
  out: "./src/main/db/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "file:./src/main/db/dev.db",
  },
});

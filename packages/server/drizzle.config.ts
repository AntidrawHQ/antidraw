import { defineConfig } from "drizzle-kit";

// Generates SQLite migrations into src/db/migrations. Applied to D1 via
// `npm run db:migrate:local` / `npm run db:migrate` (wrangler d1 migrations
// apply), not by drizzle-kit directly — D1 has no direct connection string.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});

import { Hono } from "hono";
import type { Bindings } from "./lib/env";
import { healthController } from "./controllers/health.controller";

// All routes live under /api, matching @antidraw/shell's in-Electron API so
// the two share one path convention. Mount feature controllers here:
//   api.route("/auth", authController)  // better-auth — next step
const api = new Hono<{ Bindings: Bindings }>();

api.route("/health", healthController);

const app = new Hono<{ Bindings: Bindings }>();
app.route("/api", api);

// Cloudflare Workers entrypoint — Hono exports a `fetch` handler.
export default app;

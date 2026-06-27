import { Hono } from "hono";
import type { Bindings } from "./lib/env";
import { requireSession } from "./lib/require-session";
import { healthController } from "./controllers/health.controller";
import { authController } from "./controllers/auth.controller";
import { desktopAuthController } from "./controllers/desktop-auth.controller";

// All routes live under /api, matching @antidraw/shell's in-Electron API so
// the two share one path convention. Mount feature controllers here.
const api = new Hono<{ Bindings: Bindings }>();

api.route("/health", healthController);
api.route("/auth", authController); // better-auth handler (/api/auth/*)
api.route("/desktop", desktopAuthController); // loopback sign-in for Electron

// The current user — the simplest authenticated endpoint, used by the client
// to confirm sign-in and read profile info. Gated by the same requireSession
// that cloud ops (publish/sync) will use.
api.get("/me", requireSession, (c) => c.json({ user: c.get("user") }));

const app = new Hono<{ Bindings: Bindings }>();
app.route("/api", api);

// Cloudflare Workers entrypoint — Hono exports a `fetch` handler.
export default app;

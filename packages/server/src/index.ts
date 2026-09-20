import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./lib/env";
import { respondError } from "./lib/respond";
import { healthController } from "./controllers/health.controller";

// Built by a factory so tests can mount extra routes on a real app (with the
// real fallbacks below) instead of asserting against a copy of them.
export const createApp = () => {
  // All routes live under /api, matching @antidraw/shell's in-Electron API so
  // the two share one path convention. Mount feature controllers here:
  //   api.route("/auth", authController)  // better-auth — next step
  const api = new Hono<AppEnv>();

  api.route("/health", healthController);

  const app = new Hono<AppEnv>();
  app.route("/api", api);

  // Hono's built-in fallbacks answer in text/plain, which would make a miss or
  // a crash the only two responses that break the { error: { code, message } }
  // contract every other path keeps. Route them through the same envelope so a
  // client can always parse the body.
  app.notFound((ctx) => respondError(ctx, 404, "NOT_FOUND", "Not found"));

  app.onError((error, ctx) => {
    if (error instanceof HTTPException) {
      return respondError(ctx, error.status, "HTTP_ERROR", error.message);
    }
    // Log the real cause, return a generic message — this is network-exposed,
    // so stacks and internals must not reach the client.
    console.error(error);
    return respondError(ctx, 500, "INTERNAL_ERROR", "Internal server error");
  });

  return app;
};

// Cloudflare Workers entrypoint — Hono exports a `fetch` handler.
export default createApp();

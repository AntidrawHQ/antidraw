import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./lib/env";
import { respondError } from "./lib/respond";
import { healthController } from "./controllers/health.controller";
import { authController, meController } from "./controllers/auth.controller";
import { publishController, type PublishOptions } from "./controllers/publish.controller";
import { remixController } from "./controllers/remix.controller";
import { storageController } from "./controllers/storage.controller";
import type { Bindings } from "./lib/env";
import { scheduled } from "./scheduled";

// Built by a factory so tests can mount extra routes on a real app (with the
// real fallbacks below) instead of asserting against a copy of them, and pass
// fake publish deps (`publishDeps`) instead of the Worker's bindings.
export const createApp = (opts: PublishOptions = {}) => {
  // All routes live under /api, matching @antidraw/shell's in-Electron API so
  // the two share one path convention. Mount feature controllers here.
  const api = new Hono<AppEnv>();

  api.route("/health", healthController);
  api.route("/auth", authController); // better-auth: /api/auth/*
  api.route("/me", meController);
  api.route("/publish", publishController(opts));
  api.route("/remix", remixController(opts));
  api.route("/storage", storageController); // dev only; 404 unless STORAGE_MODE="worker"

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

// Cloudflare Workers entrypoint: Hono's `fetch`, and the cron trigger's
// `scheduled` (nightly publish GC).
const app = createApp();
export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>;

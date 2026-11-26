import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Bindings } from "./lib/env";
import { respondError } from "./lib/respond";
import { healthController } from "./controllers/health.controller";
import { authController, meController } from "./controllers/auth.controller";
import { featureController } from "./controllers/feature.controller";
import { siteController } from "./controllers/site.controller";
import { getDb } from "./db";
import { retryDelaySeconds, takePreview, type PreviewMessage } from "./services/preview.service";

// Built by a factory so tests can mount extra routes on a real app (with the
// real fallbacks below) instead of asserting against a copy of them.
export const createApp = () => {
  // All routes live under /api, matching @antidraw/shell's in-Electron API so
  // the two share one path convention. Mount feature controllers here.
  const api = new Hono<AppEnv>();

  api.route("/health", healthController);
  api.route("/auth", authController); // better-auth: /api/auth/*
  api.route("/me", meController);
  api.route("/features", featureController);
  api.route("/sites", siteController);

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

const app = createApp();

// Cloudflare Workers entrypoint.
export default {
  fetch: app.fetch,
  // Sites' preview images, asked for as publishes go live
  // (services/preview.service.ts). One message a batch (wrangler.jsonc).
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const outcome = await takePreview(env, getDb(env), message.body);
        console.log(`Preview of ${message.body.siteId}/${message.body.publishId}: ${outcome}`);
        message.ack();
      } catch (error) {
        // Tried again up to max_retries, then dropped: the site keeps the
        // picture it had, or none.
        console.error(`Couldn't take a preview of ${message.body.siteId}/${message.body.publishId}:`, error);
        message.retry({ delaySeconds: retryDelaySeconds(env, message.attempts) });
      }
    }
  },
} satisfies ExportedHandler<Bindings, PreviewMessage>;

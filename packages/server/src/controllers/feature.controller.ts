import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { isFeatureOn } from "../lib/features";

// GET /api/features — which features are on for everyone, so the app can
// hide what a signed-out user can't use yet. A rule that lets in particular
// users doesn't count here; /api/me answers for the signed-in user. Not
// cached: turning a feature off should show at once.
export const featureController = new Hono<AppEnv>();

featureController.get("/", async (ctx) => {
  ctx.header("cache-control", "no-store");
  return ctx.json({ features: { publish: await isFeatureOn(ctx.env, "publish") } });
});

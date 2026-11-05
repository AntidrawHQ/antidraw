import { Hono } from "hono";
import { ok } from "neverthrow";
import { auth } from "../lib/auth";
import type { AppEnv } from "../lib/env";
import { isFeatureOn } from "../lib/features";
import { requireSession, type AuthedEnv } from "../lib/require-session";
import { respond } from "../lib/respond";
import { toPublicUser } from "../services/auth.service";

// better-auth serves everything under /api/auth/* itself (Google OAuth, the
// desktop flow, sessions, sign-out). The raw Request goes through untouched so
// it sees the full path its basePath expects.
export const authController = new Hono<AppEnv>();

authController.on(["GET", "POST"], "/*", (ctx) => auth.handler(ctx.req.raw));

// GET /api/me — the signed-in user, and which features are on for them
// (lib/features.ts). The simplest authenticated endpoint: the desktop app uses
// it to confirm a stored token still works. Apps from before `features` read
// only `user`.
export const meController = new Hono<AuthedEnv>();

meController.get("/", requireSession, async (ctx) => {
  const user = ctx.get("user");
  const features = { publish: await isFeatureOn(ctx.env, "publish", user.id) };
  return respond(ctx, ok({ user: toPublicUser(user), features }));
});

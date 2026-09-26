import { Hono } from "hono";
import { ok } from "neverthrow";
import { auth } from "../lib/auth";
import type { AppEnv } from "../lib/env";
import { requireSession, type AuthedEnv } from "../lib/require-session";
import { respond } from "../lib/respond";
import { toPublicUser } from "../services/auth.service";

// better-auth serves everything under /api/auth/* itself (Google OAuth, the
// desktop flow, sessions, sign-out). The raw Request goes through untouched so
// it sees the full path its basePath expects.
export const authController = new Hono<AppEnv>();

authController.on(["GET", "POST"], "/*", (ctx) => auth.handler(ctx.req.raw));

// GET /api/me — the signed-in user. The simplest authenticated endpoint: the
// desktop app uses it to confirm a stored token still works.
export const meController = new Hono<AuthedEnv>();

meController.get("/", requireSession, (ctx) =>
  respond(ctx, ok({ user: toPublicUser(ctx.get("user")) })),
);

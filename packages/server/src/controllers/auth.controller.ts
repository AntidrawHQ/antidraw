import { Hono } from "hono";
import type { Bindings } from "../lib/env";
import { getAuth } from "../lib/auth";

// Mounts better-auth's own handler for everything under /api/auth/* (Google
// sign-in, OAuth callback, session, sign-out, one-time-token, …). We pass the
// raw Request through untouched so better-auth sees the full /api/auth/… path
// it expects regardless of where this is mounted.
export const authController = new Hono<{ Bindings: Bindings }>();

authController.on(["POST", "GET"], "/*", (c) => getAuth(c.env).handler(c.req.raw));

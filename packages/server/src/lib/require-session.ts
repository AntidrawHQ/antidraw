import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth, type Auth } from "./auth";
import type { AppEnv } from "./env";
import { respondError } from "./respond";

export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type SessionData = Auth["$Infer"]["Session"]["session"];

// Env for any route behind requireSession: `ctx.get("user")` and
// `ctx.get("session")` are typed and always set.
export type AuthedEnv = AppEnv & {
  Variables: {
    user: SessionUser;
    session: SessionData;
  };
};

// Resolves the session from `headers` (null: no credentials) into the context.
const sessionGate = (headersOf: (ctx: Context) => Headers | null) =>
  createMiddleware<AuthedEnv>(async (ctx, next) => {
    const headers = headersOf(ctx);
    const result = headers && (await auth.api.getSession({ headers }));
    if (!result) {
      return respondError(ctx, 401, "UNAUTHORIZED", "Sign in required");
    }
    ctx.set("user", result.user);
    ctx.set("session", result.session);
    await next();
  });

// The one gate for signed-in routes; feature code reads the user from the
// context and never resolves sessions itself. The bearer plugin turns
// `Authorization: Bearer <token>` into a session before getSession looks, so
// this serves the cookie-less desktop app.
export const requireSession = sessionGate((ctx) => ctx.req.raw.headers);

// requireSession for routes that act on the user's behalf (publishing): only
// a bearer token counts, never a cookie. A browser sends a cookie by itself,
// so a cookie-authenticated route is always one CORS mistake away from any
// page acting as the user.
export const requireBearer = sessionGate((ctx) => {
  const authorization = ctx.req.header("authorization");
  return authorization?.startsWith("Bearer ") ? new Headers({ authorization }) : null;
});

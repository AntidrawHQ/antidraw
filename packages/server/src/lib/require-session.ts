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

// The one gate for signed-in routes; feature code reads the user from the
// context and never resolves sessions itself. The bearer plugin turns
// `Authorization: Bearer <token>` into a session before getSession looks, so
// this serves the cookie-less desktop app.
export const requireSession = createMiddleware<AuthedEnv>(async (ctx, next) => {
  const result = await auth.api.getSession({ headers: ctx.req.raw.headers });
  if (!result) {
    return respondError(ctx, 401, "UNAUTHORIZED", "Sign in required");
  }
  ctx.set("user", result.user);
  ctx.set("session", result.session);
  await next();
});

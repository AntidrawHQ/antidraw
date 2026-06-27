import { createMiddleware } from "hono/factory";
import type { Bindings } from "./env";
import { getAuth, type Auth } from "./auth";

type SessionUser = Auth["$Infer"]["Session"]["user"];
type SessionData = Auth["$Infer"]["Session"]["session"];

export type SessionVariables = {
  user: SessionUser;
  session: SessionData;
};

// Gate for any route that requires a signed-in user. Reads the session from the
// request — the bearer plugin turns `Authorization: Bearer <token>` into a
// session before this runs, so it works for the cookie-less desktop client.
// 401s with the standard { error: { code, message } } envelope otherwise.
// This is the boundary publish/sync will sit behind (Phase C).
export const requireSession = createMiddleware<{
  Bindings: Bindings;
  Variables: SessionVariables;
}>(async (c, next) => {
  const session = await getAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      401,
    );
  }

  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

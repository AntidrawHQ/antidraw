// A stand-in for lib/require-session in route tests, where there is no D1 for
// better-auth to find sessions in. Use it from a test file with
//
//   vi.mock("../lib/require-session", async () =>
//     (await import("../test/session")).mockRequireSession());
//
// and authenticate a request with `authHeader("user-1")`. A request without
// that header gets the real gate's 401 envelope.
import { createMiddleware } from "hono/factory";
import type { AuthedEnv, SessionData, SessionUser } from "../lib/require-session";
import { respondError } from "../lib/respond";

const PREFIX = "Bearer test-user:";

export const authHeader = (userId: string) => ({ authorization: `${PREFIX}${userId}` });

export const testUser = (id: string): SessionUser =>
  ({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as SessionUser;

export const mockRequireSession = () => ({
  requireSession: createMiddleware<AuthedEnv>(async (ctx, next) => {
    const header = ctx.req.header("authorization") ?? "";
    if (!header.startsWith(PREFIX)) {
      return respondError(ctx, 401, "UNAUTHORIZED", "Sign in required");
    }
    const id = header.slice(PREFIX.length);
    ctx.set("user", testUser(id));
    ctx.set("session", { id: `session-${id}`, userId: id } as SessionData);
    await next();
  }),
});

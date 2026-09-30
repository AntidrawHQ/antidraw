import { Hono } from "hono";
import {
  cancelSignIn,
  getAccount,
  signIn,
  signOut,
} from "@/main/services/account.service";

export const accountController = new Hono();

// The app's own pages only. Workspace previews run in the same session and
// could otherwise read the account, sign the user out, or keep opening
// sign-in tabs. Browsers send Origin on every cross-origin fetch and every
// POST; the one request without it, a same-origin or no-cors GET, can't read
// the answer from another origin.
const APP_ORIGINS = new Set([
  "antidraw://app",
  ...(process.env.NODE_ENV === "development" ? ["http://localhost:5173"] : []),
]);

accountController.use(async (ctx, next) => {
  const origin = ctx.req.header("origin");
  if (origin !== undefined && !APP_ORIGINS.has(origin)) {
    return ctx.json(
      { error: { code: "FORBIDDEN", message: "Not available to this page" } },
      403,
    );
  }
  await next();
});

// The signed-in cloud account, or null. Never exposes the token.
accountController.get("/", async (ctx) => {
  const result = await getAccount();

  if (result.isErr()) {
    const { status, code, message } = result.error;
    return ctx.json({ error: { code, message } }, status);
  }

  return ctx.json({ account: result.value });
});

// Opens the system browser and stays open until the user finishes (or the flow
// is cancelled or times out), then answers with the account.
accountController.post("/sign-in", async (ctx) => {
  const result = await signIn();

  if (result.isErr()) {
    const { status, code, message } = result.error;
    return ctx.json({ error: { code, message } }, status);
  }

  return ctx.json({ account: result.value });
});

// Ends a pending /sign-in, which then answers CANCELLED, unless its token is
// already saved.
accountController.post("/sign-in/cancel", (ctx) => {
  cancelSignIn();
  return ctx.json({ ok: true });
});

accountController.post("/sign-out", async (ctx) => {
  await signOut();
  return ctx.json({ ok: true });
});

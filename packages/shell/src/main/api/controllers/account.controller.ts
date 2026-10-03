import { Hono } from "hono";
import { APP_KEY_HEADER, isAppKey } from "@/main/lib/app-key";
import {
  cancelSignIn,
  getAccount,
  signIn,
  signOut,
} from "@/main/services/account.service";

export const accountController = new Hono();

// The app's own pages only: workspace previews run in the same session and
// could otherwise read the account, sign the user out, or keep opening
// sign-in tabs. See app-key.ts.
accountController.use(async (ctx, next) => {
  if (!isAppKey(ctx.req.header(APP_KEY_HEADER))) {
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

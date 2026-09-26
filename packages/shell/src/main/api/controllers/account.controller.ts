import { Hono } from "hono";
import {
  cancelSignIn,
  getAccount,
  signIn,
  signOut,
} from "@/main/services/account.service";

export const accountController = new Hono();

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

// Ends a pending /sign-in, which then answers CANCELLED.
accountController.post("/sign-in/cancel", (ctx) => {
  cancelSignIn();
  return ctx.json({ ok: true });
});

accountController.post("/sign-out", async (ctx) => {
  await signOut();
  return ctx.json({ ok: true });
});

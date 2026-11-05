import { Hono } from "hono";
import {
  cancelSignIn,
  getAccount,
  getFeatures,
  signIn,
  signOut,
} from "@/main/services/account.service";
import { track } from "@/main/lib/posthog";

// The app key is checked for every /api route, these included (index.ts).
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

// Which cloud features to show; off when the server can't say.
accountController.get("/features", async (ctx) => ctx.json({ features: await getFeatures() }));

// Opens the system browser and stays open until the user finishes (or the flow
// is cancelled or times out), then answers with the account.
accountController.post("/sign-in", async (ctx) => {
  track("cloud_sign_in_started");
  const result = await signIn();

  if (result.isErr()) {
    const { status, code, message } = result.error;
    if (code === "CANCELLED") track("cloud_sign_in_cancelled");
    else track("cloud_sign_in_failed", { error_code: code });
    return ctx.json({ error: { code, message } }, status);
  }

  track("cloud_sign_in_completed", {}, { antidraw_account_id: result.value.id });
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
  track("cloud_signed_out");
  return ctx.json({ ok: true });
});

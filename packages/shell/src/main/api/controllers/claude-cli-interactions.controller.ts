import { Hono } from "hono";
import { triggerClaudeLogin } from "@/main/services/claude-cli-interactions.service";
import { track } from "@/main/lib/posthog";

export const claudeCliInteractionsController = new Hono();

// Opens Terminal on `claude auth login`. "Opened" is as far as the app can
// see: the sign-in itself finishes in Terminal, and the next message_sent
// carries signed_in: true when it worked.
claudeCliInteractionsController.post("/auth/login", async (ctx) => {
  const result = await triggerClaudeLogin();

  if (result.isErr()) {
    const { status, code, message } = result.error;
    track("claude_sign_in_failed", { error_code: code });
    return ctx.json({ error: { code, message } }, status);
  }

  track("claude_sign_in_opened");
  return ctx.json(result.value);
});

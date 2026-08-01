import { Hono } from "hono";
import { triggerClaudeLogin } from "@/main/services/claude-cli-interactions.service";

export const claudeCliInteractionsController = new Hono();

claudeCliInteractionsController.post("/auth/login", async (ctx) => {
  const result = await triggerClaudeLogin();

  if (result.isErr()) {
    const { status, code, message } = result.error;
    return ctx.json({ error: { code, message } }, status);
  }

  return ctx.json(result.value);
});

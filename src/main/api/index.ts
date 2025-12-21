import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { sendMessage } from "@/main/claude-code-ops";

export const app = new Hono();

const chatMessageSchema = z.object({
  message: z.string(),
  claudeCodeSessionID: z.string().optional(),
});

app.post("/chat/message", zValidator("json", chatMessageSchema), (ctx) => {
  return streamSSE(ctx, async (stream) => {
    const { message, claudeCodeSessionID } = await ctx.req.valid("json");

    const res = sendMessage({
      message,
      claudeCodeSessionID,
    });

    if (res.isErr()) {
      stream.writeSSE({
        data: JSON.stringify({
          error: true,
          message: "ERROR_INITING_CLAUDE_CODE" as const,
        }),
      });

      return;
    }

    for await (let message of res.value) {
      stream.writeSSE({
        data: JSON.stringify(message),
      });
    }
  });
});

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { SSEMessage, SSEStreamingApi, streamSSE } from "hono/streaming";
import { z } from "zod";
import { sendMessage } from "@/main/api/claude-code-ops";
import { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const app = new Hono();

const chatMessageSchema = z.object({
  message: z.string(),
  claudeCodeSessionID: z.string().optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export type ChatMessageResponse =
  | {
      type: "message";
      message: SDKMessage;
    }
  | {
      type: "error";
      message: "ERROR_INITING_CLAUDE_CODE";
    };

const writeSSETyped = (
  stream: SSEStreamingApi,
  payload: Omit<SSEMessage, "data"> & {
    data: ChatMessageResponse;
  }
) => {
  stream.writeSSE({
    ...payload,
    data: JSON.stringify(payload.data),
  });
};

app.post("/chat/message", zValidator("json", chatMessageSchema), (ctx) => {
  return streamSSE(ctx, async (stream) => {
    const { message, claudeCodeSessionID } = await ctx.req.valid("json");

    const res = sendMessage({
      message,
      claudeCodeSessionID,
    });

    if (res.isErr()) {
      writeSSETyped(stream, {
        data: {
          type: "error",
          message: "ERROR_INITING_CLAUDE_CODE",
        },
      });

      return;
    }

    for await (let message of res.value) {
      writeSSETyped(stream, {
        data: {
          type: "message",
          message: message,
        },
      });
    }
  });
});

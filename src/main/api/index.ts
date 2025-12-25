import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { SSEMessage, SSEStreamingApi, streamSSE } from "hono/streaming";
import { z } from "zod";
import { sendMessage } from "@/main/api/claude-code-ops";
import { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  resolveOrCreateConversation,
  addMessage,
  updateConversationSession,
  convertUserPromptToSDKMessage,
} from "./services/chat.service";

export const app = new Hono();

const chatMessageSchema = z.object({
  message: z.string(),
  conversationId: z.string().optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export type ChatMessageResponse =
  | {
      type: "message";
      message: SDKMessage;
    }
  | {
      type: "error";
      message: "ERROR_INITING_CLAUDE_CODE" | (string & {});
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

app.post(
  "/chat/message",
  zValidator("json", chatMessageSchema),
  async (ctx) => {
    const { message, conversationId } = await ctx.req.valid("json");

    const conversationRes = await resolveOrCreateConversation(conversationId);

    if (conversationRes.isErr()) {
      const { status, code, message } = conversationRes.error;
      return ctx.json({ error: { code, message } }, status);
    }

    const conversation = conversationRes.value;
    const claudeCodeSessionID = conversation.claudeCodeSessionId ?? undefined;

    const res = sendMessage({
      message,
      claudeCodeSessionID,
    });

    if (res.isErr()) {
      return ctx.json(
        {
          error: {
            code: res.error,
            message: "Failed to initialize Claude Code",
          },
        },
        500
      );
    }

    return streamSSE(ctx, async (stream) => {
      let sessionId = claudeCodeSessionID;

      for await (let sdkMessage of res.value) {
        // Capture session_id from init message
        if (
          !sessionId &&
          sdkMessage.type === "system" &&
          sdkMessage.subtype === "init"
        ) {
          sessionId = sdkMessage.session_id;
          await updateConversationSession(conversation.id, sessionId);

          // Persist user message with real session_id (don't stream - FE already has it)
          const userMsg = convertUserPromptToSDKMessage(message, sessionId);
          await addMessage({
            conversationId: conversation.id,
            messageType: "user_prompt",
            sdkMessage: userMsg,
          });
        }

        // Persist and stream SDK message
        await addMessage({
          conversationId: conversation.id,
          messageType: "sdk_message",
          sdkMessage,
        });
        writeSSETyped(stream, {
          data: {
            type: "message",
            message: sdkMessage,
          },
        });
      }
    });
  }
);

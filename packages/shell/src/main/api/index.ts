import { Hono } from "hono";
export type {
  Conversation,
  Message,
  ConversationWithMessages,
} from "./models/chat.model";
export type { Workspace } from "./models/workspace.model";
export type { CreateWorkspaceResponse } from "./controllers/workspace.controller";
export type { DevServerState } from "@/main/lib/runtime-store";
export type { DevServerInfo } from "@/main/services/dev-server.service";
import { zValidator } from "@hono/zod-validator";
import type { SSEMessage, SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { sendMessage } from "@/main/api/claude-code-ops";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createConversation,
  resolveOrCreateConversation,
  addMessage,
  updateConversationSession,
  convertUserPromptToSDKMessage,
  getConversation,
} from "./services/chat.service";
import { workspaceController } from "./controllers/workspace.controller";

export const app = new Hono();

app.route("/workspaces", workspaceController);

const chatMessageSchema = z.object({
  message: z.string(),
  workspaceId: z.uuid(),
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
    const { message, workspaceId, conversationId } = ctx.req.valid("json");

    const conversationRes = await resolveOrCreateConversation(
      workspaceId,
      conversationId
    );

    if (conversationRes.isErr()) {
      const { status, code, message } = conversationRes.error;
      return ctx.json({ error: { code, message } }, status);
    }

    const conversation = conversationRes.value;
    const claudeCodeSessionID = conversation.claudeCodeSessionId ?? undefined;

    const res = sendMessage({
      message,
      workspaceId,
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

    // For resumed conversations, persist user message before streaming (we already have session ID)
    if (claudeCodeSessionID) {
      const userMsg = convertUserPromptToSDKMessage(
        message,
        claudeCodeSessionID
      );
      // TODO: think about the experience when this fails.
      await addMessage({
        conversationId: conversation.id,
        messageType: "user_prompt",
        sdkMessage: userMsg,
      });
    }

    return streamSSE(ctx, async (stream) => {
      let sessionId = claudeCodeSessionID;

      for await (let sdkMessage of res.value) {
        // Capture session_id from init message (new conversations only)
        if (
          !sessionId &&
          sdkMessage.type === "system" &&
          sdkMessage.subtype === "init"
        ) {
          sessionId = sdkMessage.session_id;
          await updateConversationSession(conversation.id, sessionId);

          // For new conversations, we must wait for init to get session_id before persisting user message
          const userMsg = convertUserPromptToSDKMessage(message, sessionId);
          // TODO: think about the experience when this fails.
          await addMessage({
            conversationId: conversation.id,
            messageType: "user_prompt",
            sdkMessage: userMsg,
          });
        }

        // Persist and stream SDK message
        // TODO: think about the experience when this fails.
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

app.get(
  "/chat/:conversationId",
  zValidator(
    "param",
    z.object({
      conversationId: z.uuid(),
    })
  ),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    const conversation = await getConversation(conversationId, {
      includeMessages: true,
    });

    if (conversation.isErr()) {
      const { status, code, message } = conversation.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(conversation.value);
  }
);

const createConversationSchema = z.object({
  workspaceId: z.uuid(),
});

app.post(
  "/chat/conversation",
  zValidator("json", createConversationSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("json");
    const result = await createConversation(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value, 201);
  }
);

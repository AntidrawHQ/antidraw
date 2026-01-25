import { Hono } from "hono";
export type {
  Conversation,
  Message,
  ConversationWithMessages,
  StreamStatus,
} from "./models/chat.model";
import type { Conversation, Message } from "./models/chat.model";
export type { Workspace } from "./models/workspace.model";
export type { CreateWorkspaceResponse } from "./controllers/workspace.controller";
export type { DevServerState } from "@/main/lib/runtime-store";
export type { DevServerInfo } from "@/main/services/dev-server.service";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { sendMessage, generateTitle } from "@/main/api/claude-code-ops";
import {
  createConversation,
  resolveOrCreateConversation,
  addMessage,
  updateConversationSession,
  updateConversationStatus,
  updateConversationTitleAndSummary,
  convertUserPromptToSDKMessage,
  getConversation,
} from "./services/chat.service";
import {
  streamEvents,
  activeStreams,
  registerStream,
  unregisterStream,
  cancelStream as cancelActiveStream,
} from "@/main/lib/stream-manager";
import { workspaceController } from "./controllers/workspace.controller";

export const app = new Hono();

app.route("/workspaces", workspaceController);

const chatMessageSchema = z.object({
  message: z.string().min(1),
  workspaceId: z.uuid(),
  conversationId: z.string().uuid().optional(),
  userMessageId: z.string().uuid(), // Frontend-generated, used for dedup
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Stream event types for SSE
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "complete" }
  | { type: "error"; error: string };

// Background processor for streaming messages
const processStream = async (
  conversation: Conversation,
  message: string,
  workspaceId: string,
  userMessageId: string,
) => {
  try {
    const claudeCodeSessionID = conversation.claudeCodeSessionId ?? undefined;
    const res = sendMessage({
      message,
      workspaceId,
      claudeCodeSessionID,
    });

    if (res.isErr()) {
      throw new Error("Failed to init Claude Code");
    }

    // Register the query for cancellation via interrupt()
    registerStream(conversation.id, res.value);

    let sessionId = claudeCodeSessionID;

    // For RESUMED conversations: persist user message immediately with frontend's ID
    if (sessionId) {
      const userMsg = convertUserPromptToSDKMessage(message, sessionId);
      await addMessage({
        id: userMessageId, // Use frontend-generated ID for dedup
        conversationId: conversation.id,
        messageType: "user_prompt",
        sdkMessage: userMsg,
      });
    }

    for await (const sdkMessage of res.value) {

      // For NEW conversations: wait for init message to get session_id
      if (
        !sessionId &&
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "init"
      ) {
        sessionId = sdkMessage.session_id;
        await updateConversationSession(conversation.id, sessionId);

        const userMsg = convertUserPromptToSDKMessage(message, sessionId);
        await addMessage({
          id: userMessageId, // Use frontend-generated ID for dedup
          conversationId: conversation.id,
          messageType: "user_prompt",
          sdkMessage: userMsg,
        });
      }

      // SDK messages use server-generated IDs
      await addMessage({
        conversationId: conversation.id,
        messageType: "sdk_message",
        sdkMessage,
      });
    }

    await updateConversationStatus(conversation.id, "completed");
    streamEvents.emit("complete", conversation.id);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    streamEvents.emit("error", conversation.id, errorMessage);
    await updateConversationStatus(conversation.id, "error");
  } finally {
    unregisterStream(conversation.id);
  }
};

app.post(
  "/chat/message",
  zValidator("json", chatMessageSchema),
  async (ctx) => {
    const { message, workspaceId, conversationId, userMessageId } =
      ctx.req.valid("json");

    const conversationRes = await resolveOrCreateConversation(
      workspaceId,
      conversationId,
    );

    if (conversationRes.isErr()) {
      const { status, code, message } = conversationRes.error;
      return ctx.json({ error: { code, message } }, status);
    }

    const conversation = conversationRes.value;

    // Short circuit with in-memory check first (faster, handles race condition)
    if (activeStreams.has(conversation.id)) {
      return ctx.json(
        {
          error: {
            code: "ALREADY_STREAMING",
            message: "Wait for current response",
          },
        },
        409,
      );
    }

    // DB check as fallback (handles app restart edge case)
    if (conversation.streamStatus === "streaming") {
      return ctx.json(
        {
          error: {
            code: "ALREADY_STREAMING",
            message: "Wait for current response",
          },
        },
        409,
      );
    }

    await updateConversationStatus(conversation.id, "streaming");

    // Fire and forget - inner try/catch handles errors, this prevents unhandled rejections
    processStream(conversation, message, workspaceId, userMessageId).catch(console.error);

    return ctx.json({ conversationId: conversation.id }, 202);
  },
);

app.get(
  "/chat/:conversationId",
  zValidator(
    "param",
    z.object({
      conversationId: z.uuid(),
    }),
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
  },
);

// SSE endpoint for subscribing to stream events
app.get(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    // Validate conversation exists before opening stream
    const conversation = await getConversation(conversationId);
    if (conversation.isErr()) {
      const { status, code, message } = conversation.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return streamSSE(ctx, async (stream) => {
      const onMessage = (convId: string, message: Message) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({
            type: "message",
            message,
          } satisfies StreamEvent),
        });
      };

      const onComplete = (convId: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "complete" } satisfies StreamEvent),
        });
      };

      const onError = (convId: string, error: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "error", error } satisfies StreamEvent),
        });
      };

      streamEvents.on("message", onMessage);
      streamEvents.on("complete", onComplete);
      streamEvents.on("error", onError);

      ctx.req.raw.signal.addEventListener("abort", () => {
        streamEvents.off("message", onMessage);
        streamEvents.off("complete", onComplete);
        streamEvents.off("error", onError);
      });

      // Keep alive until client disconnects
      await new Promise(() => {});
    });
  },
);

// Cancel an active stream
app.delete(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    // Just trigger interrupt - stream will end naturally via processStream
    if (await cancelActiveStream(conversationId)) {
      return ctx.json({ cancelled: true });
    }

    return ctx.json({ cancelled: false }, 404);
  },
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
  },
);

const generateTitleSchema = z.object({
  firstMessage: z.string().min(1),
});

app.post(
  "/chat/:conversationId/generate-title",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  zValidator("json", generateTitleSchema),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");
    const { firstMessage } = ctx.req.valid("json");

    const result = await generateTitle(firstMessage);

    if (result.isErr()) {
      return ctx.json(
        { error: { code: result.error, message: "Failed to generate title" } },
        500,
      );
    }

    const { title, summary } = result.value;
    const updateResult = await updateConversationTitleAndSummary(
      conversationId,
      title,
      summary,
    );

    if (updateResult.isErr()) {
      const { status, code, message } = updateResult.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ title, summary });
  },
);

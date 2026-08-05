import {
  conversations,
  messages,
  type StreamStatus,
} from "@/main/api/models/chat.model";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { db } from "@/main/db";
import type { ImageAttachment } from "@/shared/utils/message";
import { streamEvents } from "@/main/lib/stream-manager";
import { createUserSDKMessage } from "@/shared/utils/message";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { eq, desc } from "drizzle-orm";
import { ok, err } from "neverthrow";

export const createConversation = async (
  workspaceId: string,
  options?: {
    title?: string;
    // Snapshot of the composer's selection at creation time — the
    // conversation's requested model/effort from its first message on.
    selectedModel?: string;
    selectedEffort?: EffortLevel;
  }
) => {
  try {
    const id = crypto.randomUUID();
    const [conversation] = await db
      .insert(conversations)
      .values({
        id,
        workspaceId,
        title: options?.title ?? null,
        selectedModel: options?.selectedModel ?? null,
        selectedEffort: options?.selectedEffort ?? null,
        optionsUpdatedAt:
          options?.selectedModel !== undefined ||
          options?.selectedEffort !== undefined
            ? new Date()
            : null,
      })
      .returning();

    return ok(conversation);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to create conversation",
    });
  }
};

// Requested options for the conversation. Only overwrites what the caller
// sent — an effort-only change must not null out the model.
export const updateConversationOptions = async (
  conversationId: string,
  options: { selectedModel?: string; selectedEffort?: EffortLevel }
) => {
  try {
    await db
      .update(conversations)
      .set({
        ...(options.selectedModel !== undefined
          ? { selectedModel: options.selectedModel }
          : {}),
        ...(options.selectedEffort !== undefined
          ? { selectedEffort: options.selectedEffort }
          : {}),
        optionsUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to update conversation options",
    });
  }
};

// The small read the renderer's options query consumes: requested state
// (intent) plus the durable effort echo (actual), with the timestamps the
// display derivation arbitrates between.
export const getConversationOptions = async (conversationId: string) => {
  try {
    const res = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      columns: {
        selectedModel: true,
        selectedEffort: true,
        optionsUpdatedAt: true,
        actualEffort: true,
        actualEffortAt: true,
      },
    });
    if (!res) {
      return err({
        status: 404 as const,
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }
    return ok(res);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to fetch conversation options",
    });
  }
};

// Durable cache of the CLI's Stop-hook effort echo. Writes ONLY the actual*
// fields — the requested selected* fields are user intent and must never be
// echo-written. updatedAt is deliberately untouched: an echo is not user
// activity and shouldn't reorder the sidebar.
export const recordActualEffort = async (
  conversationId: string,
  level: EffortLevel
) => {
  try {
    await db
      .update(conversations)
      .set({ actualEffort: level, actualEffortAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to record actual effort",
    });
  }
};

export const listConversations = async (workspaceId: string) => {
  try {
    const result = await db
      .select()
      .from(conversations)
      .where(eq(conversations.workspaceId, workspaceId))
      .orderBy(desc(conversations.updatedAt));

    return ok(result);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to list conversations",
    });
  }
};

export const resolveOrCreateConversation = async (
  workspaceId: string,
  conversationId?: string
) => {
  if (conversationId) {
    return getConversation(conversationId);
  }
  return createConversation(workspaceId);
};

export const getConversation = async (
  conversationID: string,
  options: {
    includeMessages: boolean;
  } = {
    includeMessages: false,
  }
) => {
  try {
    const { includeMessages } = options;

    const res = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationID),
      ...(includeMessages
        ? {
            with: {
              messages: {
                orderBy: (messages, { asc }) => asc(messages.createdAt),
              },
            },
          }
        : {}),
    });

    if (!res) {
      return err({
        status: 404 as const,
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    return ok(res);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to fetch conversation",
    });
  }
};

export const convertUserPromptToSDKMessage = (
  prompt: string,
  images?: ImageAttachment[]
) => {
  return createUserSDKMessage({
    text: prompt,
    uuid: crypto.randomUUID(),
    images,
  });
};

export const addMessage = async (params: {
  id?: string; // Optional - frontend can provide for dedup
  conversationId: string;
  messageType: "user_prompt" | "sdk_message";
  sdkMessage: SDKMessage;
}) => {
  const id = params.id ?? crypto.randomUUID();

  try {
    const [message] = await db
      .insert(messages)
      .values({
        id,
        conversationId: params.conversationId,
        messageType: params.messageType,
        sdkMessage: params.sdkMessage,
      })
      .returning();

    // Emit after insert - automatic, can't forget
    streamEvents.emit("message", params.conversationId, message);

    return ok(message);
  } catch (e) {
    // Handle duplicate ID (essentially impossible with UUID v4, but be safe)
    if (
      e instanceof Error &&
      e.message.includes("SQLITE_CONSTRAINT_PRIMARYKEY")
    ) {
      return err({
        status: 409 as const,
        code: "DUPLICATE_ID",
        message: "Message ID already exists",
      });
    }
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to add message",
    });
  }
};

export const updateConversationSession = async (
  conversationId: string,
  claudeCodeSessionId: string
) => {
  try {
    await db
      .update(conversations)
      .set({ claudeCodeSessionId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to update session",
    });
  }
};

// Crash recovery: any conversation left at "streaming" can only mean the
// previous app session crashed mid-turn (in-memory activeStreams is gone on
// boot). Reset to "idle" so the UI doesn't render a phantom shimmer for a
// stream that no longer exists. (Legacy "completed" rows are handled once by
// migration 0001_normalize_completed_stream_status, not here.)
export const resetStreamingConversations = async () => {
  try {
    await db
      .update(conversations)
      .set({ streamStatus: "idle" })
      .where(eq(conversations.streamStatus, "streaming"));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to reset streaming conversations",
    });
  }
};

export const updateConversationStatus = async (
  conversationId: string,
  status: StreamStatus
) => {
  try {
    await db
      .update(conversations)
      .set({ streamStatus: status, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to update conversation status",
    });
  }
};

export const updateConversationTitleAndSummary = async (
  conversationId: string,
  title: string,
  summary: string
) => {
  try {
    const updatedAt = new Date();
    await db
      .update(conversations)
      .set({ title, summary, updatedAt })
      .where(eq(conversations.id, conversationId));
    return ok({ title, summary, updatedAt });
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to update conversation title and summary",
    });
  }
};

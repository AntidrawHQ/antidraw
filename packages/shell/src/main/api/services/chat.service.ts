import type { UUID } from "node:crypto";
import {
  conversations,
  messages,
  type Conversation,
  type ConversationRow,
} from "@/main/api/models/chat.model";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { db } from "@/main/db";
import type { ImageAttachment } from "@/shared/utils/message";
import { getStreamStatus, streamEvents } from "@/main/lib/stream-manager";

// Every conversation that leaves the service carries its live stream status,
// read from memory at that moment. The status is not a column (see
// StreamStatus in chat.model) — attaching it here is what keeps every read
// path (load, list, create, resolve) current by construction.
const withStreamStatus = <T extends ConversationRow>(
  row: T
): T & Pick<Conversation, "streamStatus"> => ({
  ...row,
  streamStatus: getStreamStatus(row.id),
});
import { createUserSDKMessage } from "@/shared/utils/message";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { eq, desc } from "drizzle-orm";
import { ok, err } from "neverthrow";

export const createConversation = async (
  workspaceId: string,
  options?: {
    title?: string;
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
      })
      .returning();

    return ok(withStreamStatus(conversation));
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to create conversation",
    });
  }
};

// The send-time options snapshot — the ONLY writer of these columns; the
// renderer reads them back (via the conversation row) as the picker's
// default. The two fields deliberately differ:
// - selectedModel: full overwrite, null included. Absent model is a real
//   choice — the picker's "Default" row means "CLI default".
// - selectedEffort: preserved when absent. Effort-capable models always
//   resolve a level (clampEffort falls back to the default), so an absent
//   effort only ever means "the sent model takes no effort level" — and an
//   inapplicable turn must not erase the user's last applicable choice.
export const setConversationOptions = async (
  conversationId: string,
  options: { selectedModel: string | null; selectedEffort?: EffortLevel }
) => {
  try {
    await db
      .update(conversations)
      .set({
        selectedModel: options.selectedModel,
        ...(options.selectedEffort !== undefined
          ? { selectedEffort: options.selectedEffort }
          : {}),
      })
      .where(eq(conversations.id, conversationId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to set conversation options",
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

    return ok(result.map(withStreamStatus));
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

    return ok(withStreamStatus(res));
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to fetch conversation",
    });
  }
};

// The persisted copy of a user prompt carries the frontend's userMessageId as
// its SDK uuid — the same uuid stamped on the message pushed to the CLI, so
// the row, the optimistic renderer bubble, and the CLI's replay ack all name
// one message.
export const convertUserPromptToSDKMessage = (
  prompt: string,
  userMessageId: UUID,
  images?: ImageAttachment[]
) => {
  return createUserSDKMessage({
    text: prompt,
    uuid: userMessageId,
    images,
  });
};

// Removes a message row. Used when a queued (not yet accepted) user prompt
// is withdrawn from the CLI's queue: the send-time user_prompt row is the
// only copy, and a message that never ran must not survive in history.
export const deleteMessage = async (messageId: string) => {
  try {
    await db.delete(messages).where(eq(messages.id, messageId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to delete message",
    });
  }
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

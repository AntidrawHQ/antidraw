import type { UUID } from "node:crypto";
import {
  conversations,
  messages,
  type Conversation,
  type ConversationRow,
  type Message,
} from "@/main/api/models/chat.model";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { db } from "@/main/db";
import type { ImageAttachment } from "@/shared/utils/message";
import {
  getStreamStatus,
  conversationEvents,
} from "@/main/lib/conversation-store";

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
import { eq, desc, and, gt, asc, isNull } from "drizzle-orm";
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

    return ok(withStreamStatus(conversation!));
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
                // seq, not createdAt: createdAt has second resolution, so a
                // turn's messages share a timestamp and this ordering was a
                // tie-break on nothing. Restored transcripts could disagree
                // with what the renderer showed live.
                orderBy: (messages, { asc }) => asc(messages.seq),
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

// The transcript after a point, for a subscriber that is resuming. `afterSeq`
// is exclusive: it is the last seq the caller already has, so a caller fully
// caught up gets nothing back. Ordered by seq, and covered end to end by
// idx_messages_conv_seq.
//
// A Result like its neighbours, and the caller depends on that: this is
// awaited inside the SSE route ahead of every seed, where a rejection would
// unwind the handler and strand the subscriber it just attached. An err lets
// the route skip the replay and stay live instead.
export const getMessagesAfterSeq = async (
  conversationId: string,
  afterSeq: number
) => {
  try {
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          gt(messages.seq, afterSeq)
        )
      )
      .orderBy(asc(messages.seq));
    return ok(rows);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to read the transcript after the cursor",
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

// The CLI's replay ack, made durable. Idempotent: a second ack for the same
// id (a resumed session replays its history) rewrites the same column. A uuid
// we never stamped — the CLI replays its own internal reminders too — matches
// no row and is a no-op.
export const markDelivered = async (messageId: string) => {
  try {
    await db
      .update(messages)
      .set({ deliveredAt: new Date() })
      .where(eq(messages.id, messageId));
    return ok(undefined);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to mark message delivered",
    });
  }
};

// Prompts with no ack on record. Whether each one is still queued or has
// failed is the caller's question — it needs the live pending set to answer.
export const getUndeliveredPromptIds = async (conversationId: string) => {
  try {
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.messageType, "user_prompt"),
          isNull(messages.deliveredAt)
        )
      )
      .orderBy(asc(messages.seq));
    return ok(rows.map((r) => r.id));
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to read undelivered prompts",
    });
  }
};

// A duplicate message id. id is a UNIQUE column rather than the primary key
// (seq took that role), so this is the constraint libsql reports — and it is
// the only unique constraint on the table.
//
// Read through the cause chain rather than matching on e.message: drizzle
// wraps driver errors in a DrizzleQueryError whose own message is only
// "Failed query: ...". The driver error, with the constraint name on it, is
// the cause.
const isUniqueViolation = (e: unknown): boolean => {
  for (let cause: unknown = e; cause instanceof Error; cause = cause.cause) {
    if ((cause as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
  }
  return false;
};

export const addMessage = async (params: {
  id?: string; // Optional - frontend can provide for dedup
  conversationId: string;
  messageType: "user_prompt" | "sdk_message";
  sdkMessage: SDKMessage;
}) => {
  const id = params.id ?? crypto.randomUUID();

  try {
    const [inserted] = await db
      .insert(messages)
      .values({
        id,
        conversationId: params.conversationId,
        messageType: params.messageType,
        sdkMessage: params.sdkMessage,
      })
      .returning();
    // An insert of one row returns that row. Asserted here rather than at each
    // use so the ok() below does not hand callers a `Message | undefined`.
    const message = inserted!;

    // A user prompt is the one thing that moves a conversation in the
    // sidebar. The list orders by updatedAt, and only the user's own input
    // counts as activity — a reply lands where the prompt already put it.
    // It lives here, next to the insert every prompt passes through, so a
    // rework of the send path cannot drop it the way removing the status
    // write did. Its own try: a failed bump must not turn a persisted prompt
    // into a reported failure.
    if (params.messageType === "user_prompt") {
      try {
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, params.conversationId));
      } catch (e) {
        console.error("Failed to bump the conversation's updatedAt:", e);
      }
    }

    // Emit after insert - automatic, can't forget
    conversationEvents.emit("message", params.conversationId, { message });

    return ok(message);
  } catch (e) {
    // Handle duplicate ID (essentially impossible with UUID v4, but be safe)
    if (isUniqueViolation(e)) {
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

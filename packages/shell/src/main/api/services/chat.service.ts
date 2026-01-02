import { conversations, messages } from "@/main/api/models/chat.model";
import { db } from "@/main/db";
import { createUserSDKMessage } from "@/shared/utils/message";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { ok, err } from "neverthrow";

export const createConversation = async (workspaceId: string, title?: string) => {
  try {
    const id = crypto.randomUUID();
    const [conversation] = await db
      .insert(conversations)
      .values({
        id,
        workspaceId,
        title: title ?? null,
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
  sessionId: string
) => {
  return createUserSDKMessage({
    text: prompt,
    sessionId,
    uuid: crypto.randomUUID(),
  });
};

export const addMessage = async (params: {
  conversationId: string;
  messageType: "user_prompt" | "sdk_message";
  sdkMessage: SDKMessage;
}) => {
  try {
    const id = crypto.randomUUID();
    const [message] = await db
      .insert(messages)
      .values({
        id,
        conversationId: params.conversationId,
        messageType: params.messageType,
        sdkMessage: params.sdkMessage,
      })
      .returning();
    return ok(message);
  } catch (_e) {
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

import { sql } from "drizzle-orm";
import { text, integer, sqliteTable, index } from "drizzle-orm/sqlite-core";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { relations } from "drizzle-orm";
import { workspaces } from "./workspace.model";

// Use text + TS type (not SQLite enum - simpler, no migration issues for new statuses)
export type StreamStatus =
// @CLAUDE-CODE: what does idle do. what's the difference b/w completed and idle ? do we need completed ? when a stream ends it goes back to idel ?
| "idle"
  | "streaming"
  | "completed"
  | "error"
  | "cancelled";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  claudeCodeSessionId: text("claude_code_session_id"),
  title: text("title"),
  summary: text("summary"),
  streamStatus: text("stream_status").$type<StreamStatus>().default("idle"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageType: text("message_type").notNull(), // 'user_prompt' | 'sdk_message'
    sdkMessage: text("sdk_message", { mode: "json" })
      .$type<SDKMessage>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("idx_messages_conv_created").on(table.conversationId, table.createdAt),
  ]
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [conversations.workspaceId],
    references: [workspaces.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

// Type exports
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ConversationWithMessages = Conversation & { messages: Message[] };

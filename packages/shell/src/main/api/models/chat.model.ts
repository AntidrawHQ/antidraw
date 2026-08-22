import { sql } from "drizzle-orm";
import { text, integer, sqliteTable, index } from "drizzle-orm/sqlite-core";
import type { EffortLevel, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { relations } from "drizzle-orm";
import { workspaces } from "./workspace.model";

// Not a column. A stream cannot outlive the process (the CLI is a child),
// so the live status is in-memory truth (stream-manager: activeStreams +
// the CLI's reported session state) and is attached to conversation rows
// at the service boundary. "streaming" while the CLI says a turn is in
// flight, "idle" otherwise.
export type StreamStatus = "idle" | "streaming";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  claudeCodeSessionId: text("claude_code_session_id"),
  title: text("title"),
  summary: text("summary"),
  // Options travel with the message: the send is the only writer of these
  // columns, and the composer reads them back as its default for the next
  // send. Nothing else writes or applies options. selectedModel is the
  // latest send's snapshot (null = CLI default); selectedEffort is the last
  // APPLICABLE choice — a send on an effort-less model (Haiku) omits effort
  // and leaves this column untouched rather than erasing it.
  selectedModel: text("selected_model"),
  selectedEffort: text("selected_effort").$type<EffortLevel>(),
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
export type ConversationRow = typeof conversations.$inferSelect;
// What the API hands out: the row plus the live, in-memory stream status.
export type Conversation = ConversationRow & { streamStatus: StreamStatus };
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ConversationWithMessages = Conversation & { messages: Message[] };

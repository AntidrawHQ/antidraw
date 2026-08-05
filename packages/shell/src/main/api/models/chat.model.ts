import { sql } from "drizzle-orm";
import { text, integer, sqliteTable, index } from "drizzle-orm/sqlite-core";
import type { EffortLevel, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { relations } from "drizzle-orm";
import { workspaces } from "./workspace.model";

// Use text + TS type (not SQLite enum - simpler, no migration issues for new statuses)
export type StreamStatus =
  // "idle" at rest, "streaming" while a turn is in flight, "error" if it failed.
  // A finished turn returns to "idle"; the UI only distinguishes streaming vs not.
  // ("completed" was dropped — the backend never persisted it and no reader
  // branched on it. Legacy "completed" rows are normalized to "idle" on boot.)
  | "idle"
  | "streaming"
  | "error";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  claudeCodeSessionId: text("claude_code_session_id"),
  title: text("title"),
  summary: text("summary"),
  // The user's REQUESTED model/effort (intent, null = CLI defaults). Written
  // by the options endpoint / conversation create; read at cold start as
  // query() options. Deliberately never echo-written — actual state lives in
  // the transcript (model) and the actual* fields below (effort), so a
  // transient CLI downgrade can't become a permanent request.
  selectedModel: text("selected_model"),
  selectedEffort: text("selected_effort").$type<EffortLevel>(),
  // When the user last changed the requested options. Display derivation
  // arbitrates requested-vs-echo by comparing this against echo timestamps;
  // null = never explicitly requested (echoes always win).
  optionsUpdatedAt: integer("options_updated_at", { mode: "timestamp_ms" }),
  // Last CLI Stop-hook effort echo — ACTUAL state cache, not intent. The
  // selected* fields above are never echo-written; these two are never
  // user-written. Durable so the last known downgrade survives app restarts
  // (the model echo needs no column: it lives in the transcript).
  actualEffort: text("actual_effort").$type<EffortLevel>(),
  actualEffortAt: integer("actual_effort_at", { mode: "timestamp_ms" }),
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

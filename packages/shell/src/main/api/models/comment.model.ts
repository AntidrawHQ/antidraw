import { sql } from "drizzle-orm";
import { text, integer, real, sqliteTable, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { workspaces } from "./workspace.model";
import { conversations } from "./chat.model";

// A comment left for Claude on a frame. "draft" until Send, which hands it
// to a new conversation as "sent"; "done" once Claude marks it completed
// (complete_comment) with a note on what it changed. The comments sent
// together are a set: they share their conversation.
export type CommentState = "draft" | "sent" | "done";

export const comments = sqliteTable(
  "comments",
  {
    // An integer, so Claude reads and names it as "4", not a UUID.
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    componentName: text("component_name").notNull(),
    // The pin, in the frame's CSS pixels from its top left.
    x: real("x").notNull(),
    y: real("y").notNull(),
    // The element under the pin, as the canvas inspector picked it (the
    // renderer's Picked["info"]). Null when the frame couldn't say.
    element: text("element", { mode: "json" }).$type<Record<string, unknown>>(),
    text: text("text").notNull(),
    state: text("state").$type<CommentState>().notNull().default("draft"),
    note: text("note"),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    // Taken off the list (× on a sent one, or Clear completed). Kept, so
    // later chats are still handed it as history.
    clearedAt: integer("cleared_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("comments_workspace_idx").on(table.workspaceId),
    index("comments_conversation_idx").on(table.conversationId),
  ]
);

export const commentsRelations = relations(comments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [comments.workspaceId],
    references: [workspaces.id],
  }),
  conversation: one(conversations, {
    fields: [comments.conversationId],
    references: [conversations.id],
  }),
}));

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

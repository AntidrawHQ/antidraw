import { text, sqliteTable, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { workspaces } from "./workspace.model";

export const uiPreferences = sqliteTable(
  "ui_preferences",
  {
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })]
);

export const uiPreferencesRelations = relations(uiPreferences, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [uiPreferences.workspaceId],
    references: [workspaces.id],
  }),
}));

export type UiPreference = typeof uiPreferences.$inferSelect;
export type NewUiPreference = typeof uiPreferences.$inferInsert;

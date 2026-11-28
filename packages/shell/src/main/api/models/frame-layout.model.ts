import { text, real, integer, sqliteTable, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { workspaces } from "./workspace.model";

export const frameLayouts = sqliteTable(
  "frame_layouts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // TODO: switch to component path if we add nested folder support
    componentName: text("component_name").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    // Its size was set in its toolbar's size menu, and its height hugs its
    // content (Auto): see the canvas's FrameLayout.
    sized: integer("sized", { mode: "boolean" }).notNull().default(false),
    autoHeight: integer("auto_height", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.componentName] }),
  ]
);

export const frameLayoutsRelations = relations(frameLayouts, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [frameLayouts.workspaceId],
    references: [workspaces.id],
  }),
}));

export type FrameLayout = typeof frameLayouts.$inferSelect;
export type NewFrameLayout = typeof frameLayouts.$inferInsert;

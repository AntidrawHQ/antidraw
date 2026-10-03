import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth.model";

// A published site. `id` is permanent and keys the site's files in R2; `slug`
// is its public name (<slug>.antidraw.app) and only points at the id, so a slug
// that is ever freed and claimed again never reaches the old site's data.
//
// R2 holds what never changes: files by hash, and each publish's manifest
// (@antidraw/site-upload). This row is the one thing that does: which publish
// is live, the one live before it (its hashed chunks stay servable), and seq,
// which counts commits. A commit switches them only if seq is still the
// publish's base_seq, so two publishes can't both go live on the same version,
// and an old one retried late can't roll the site back.
export const site = sqliteTable(
  "site",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    livePublishId: text("live_publish_id"),
    previousPublishId: text("previous_publish_id"),
    seq: integer("seq").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("site_owner_id_idx").on(table.ownerId)],
);

// One publish of a site. base_seq is the site's seq when it started: the
// version it builds on. committed_at is set when it goes live.
export const publish = sqliteTable(
  "publish",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    baseSeq: integer("base_seq").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    committedAt: integer("committed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("publish_site_id_idx").on(table.siteId)],
);

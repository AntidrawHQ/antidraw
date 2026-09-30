import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth.model";

// A published site. `id` is permanent and keys the site's files in R2; `slug`
// is its public name (<slug>.antidraw.app) and only points at the id, so a slug
// that is ever freed and claimed again never reaches the old site's data.
//
// The lock serializes a site's publishes, which @antidraw/site-upload requires
// (plan, uploads, commit and cleanup must not overlap). lock_publish_id is the
// publish allowed to upload; starting a new one takes the lock over, and every
// upload request checks it, so a replaced publish's requests are refused.
// lock_until is when an unfinished publish is abandoned (its plan expires);
// commit clears both.
//
// busy_until is set while a request that cleans up is running (a plan or a
// commit, or the scheduled cleanup, whose claim is a `cleanup-` lock id): a
// new publish can't take the lock until it's cleared or lapses, so a cleanup
// never overlaps another publish's plan or commit.
//
// cleanup_after is when what the site's publishes left behind (uploads never
// committed, files the live version dropped) is past the library's plan TTL
// and orphan grace period, so the scheduled cleanup can clear it. Starting a
// publish pushes it back; the cleanup clears it.
export const site = sqliteTable(
  "site",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    lockPublishId: text("lock_publish_id"),
    lockUntil: integer("lock_until", { mode: "timestamp_ms" }),
    busyUntil: integer("busy_until", { mode: "timestamp_ms" }),
    cleanupAfter: integer("cleanup_after", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("site_owner_id_idx").on(table.ownerId),
    index("site_cleanup_after_idx").on(table.cleanupAfter),
  ],
);

// One publish of a site: started, then live once its commit succeeds.
// `previous` is the publish it replaced, as the commit reported it.
export const publish = sqliteTable(
  "publish",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "live"] }).notNull(),
    previous: text("previous"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    committedAt: integer("committed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("publish_site_id_idx").on(table.siteId)],
);

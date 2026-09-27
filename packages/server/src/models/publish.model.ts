import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth.model";

// Publish + remix. A `site` is one workspace's published canvas at
// <slug>.antidraw.app; each successful publish adds a `site_version`, which
// points at the account's content-addressed objects (`stored_object`): its
// snapshot (source archive and blobs, in the private SOURCES bucket) and its
// site files' contents (`version_site_file`, in the public SITES bucket).
// Visitors see the version the site's pointer (m/<slug>.json) names. A
// `publish_session` spans begin -> uploads -> complete and holds its objects
// while its upload URLs are usable. The SQL that keeps these consistent lives
// in services/publish.store.ts.

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull();

export const site = sqliteTable(
  "site",
  {
    id: text("id").primaryKey(), // "site_" + random
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientWorkspaceId: text("client_workspace_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    headVersion: integer("head_version").notNull().default(0),
    // The one remix setting; remix reads this, not the version's copy.
    allowRemix: integer("allow_remix", { mode: "boolean" }).notNull().default(true),
    // The version the site's pointer was last seen at (written, or found
    // written); GC re-syncs a site whose pointer is behind head_version.
    pointerVersion: integer("pointer_version").notNull().default(0),
    completeLock: text("complete_lock"),
    completeLockExpiresAt: integer("complete_lock_expires_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("site_userId_clientWorkspaceId_uidx").on(t.userId, t.clientWorkspaceId),
    // Partial: only GC's pointer re-sync reads the (few) sites behind.
    index("site_pointer_behind_partial_idx")
      .on(t.headVersion)
      .where(sql`${t.pointerVersion} < ${t.headVersion}`),
  ],
);

export const siteVersion = sqliteTable(
  "site_version",
  {
    id: text("id").primaryKey(), // "ver_" + random
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sourceSize: integer("source_size").notNull(),
    snapshotBytes: integer("snapshot_bytes").notNull(),
    fileCount: integer("file_count").notNull(),
    siteFileCount: integer("site_file_count").notNull(),
    siteBytes: integer("site_bytes").notNull(),
    // The estimated D1 bytes of the version's version_site_file rows still
    // retained (siteFileRowBytes in publish.store.ts): counted toward the
    // account's MAX_SITE_FILE_ROW_BYTES, and lowered when the rows no pointer
    // can use any more are pruned.
    siteFileRowBytes: integer("site_file_row_bytes").notNull().default(0),
    // A record of the setting at commit only; remix reads site.allow_remix.
    allowRemix: integer("allow_remix", { mode: "boolean" }).notNull().default(true),
    keep: integer("keep", { mode: "boolean" }).notNull().default(false),
    publishSessionId: text("publish_session_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("site_version_siteId_version_uidx").on(t.siteId, t.version),
    index("site_version_userId_sourceSha256_idx").on(t.userId, t.sourceSha256),
  ],
);

export const versionLargeFile = sqliteTable(
  "version_large_file",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => siteVersion.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    mode: integer("mode").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.path] }),
    index("version_large_file_userId_sha256_idx").on(t.userId, t.sha256),
  ],
);

// A version's site files: what its pointer lists. The content is the
// account's `stored_object` of kind "site" with this sha256. Once the site's
// pointer has moved past a version, only its rows a pointer's grace entries
// can use (the immutable ones) are kept.
export const versionSiteFile = sqliteTable(
  "version_site_file",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => siteVersion.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    // The build named it by its content (plan immutable, at an
    // isImmutableSitePath): the pointer marks it "i", which the publish Worker
    // caches for a year, and older versions' such rows are its grace entries.
    immutable: integer("immutable", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.path] }),
    index("version_site_file_userId_sha256_idx").on(t.userId, t.sha256),
  ],
);

// Content-addressed per account. "source" and "blob" live in SOURCES and
// count toward the storage quota; "site" lives in SITES and does not (its
// uncommitted bytes count toward MAX_PENDING_SITE_BYTES instead).
export const storedObject = sqliteTable(
  "stored_object",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["source", "blob", "site"] }).notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    // GC claimed it; everything else treats the object as missing.
    deleting: integer("deleting", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.sha256] }),
    index("stored_object_createdAt_idx").on(t.createdAt),
    // Partial: only GC's leftover scan reads `deleting = 1`. A full index on
    // the flag would win the planner's choice (D1 has no ANALYZE statistics)
    // for every `deleting = 0` query and scan all accounts' rows.
    index("stored_object_deleting_partial_idx")
      .on(t.deleting)
      .where(sql`${t.deleting} = 1`),
  ],
);

export const publishSession = sqliteTable(
  "publish_session",
  {
    id: text("id").primaryKey(), // "pub_" + random
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    baseVersion: integer("base_version").notNull(),
    status: text("status", { enum: ["pending", "completed", "aborted", "expired"] })
      .notNull()
      .default("pending"),
    plan: text("plan").notNull(), // JSON, zod-parsed on read
    resultVersion: integer("result_version"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    // Upload URLs stay valid until then; 0 = none were issued, or GC retired
    // the session after its hold ended.
    holdUntil: integer("hold_until", { mode: "timestamp_ms" }).notNull(),
    // Σ size of the plan's site contents no commit had verified at begin;
    // counts toward MAX_PENDING_SITE_BYTES while the session holds and has
    // not committed.
    siteUploadBytes: integer("site_upload_bytes").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("publish_session_userId_status_idx").on(t.userId, t.status),
    index("publish_session_expiresAt_idx").on(t.expiresAt),
    index("publish_session_holdUntil_idx").on(t.holdUntil),
    index("publish_session_siteId_idx").on(t.siteId),
  ],
);

export const publishSessionObject = sqliteTable(
  "publish_session_object",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => publishSession.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["source", "blob", "site"] }).notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    // An earlier complete of the session found the object in R2 (a HEAD of
    // the declared size and sha256): a retried complete does not HEAD it
    // again. Only GC deletes objects, and never one a session holds.
    present: integer("present", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.kind, t.sha256] }),
    index("publish_session_object_userId_kind_sha256_idx").on(t.userId, t.kind, t.sha256),
  ],
);

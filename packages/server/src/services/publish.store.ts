import { sql, type SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import { D1_MAX_PARAMS } from "../lib/publish-limits";

// Every D1 statement publish + remix + GC run, behind one structural type so
// services and tests can swap in src/test/memory-publish-store.ts. Raw SQL
// rather than the query builder: the guarded statements (the commit guard,
// the GC claim) need subqueries and row values the builder cannot express,
// and raw SQL keeps each statement's bound-parameter count visible (D1
// refuses more than 100 per statement, also inside a batch; see `chunk`).
// Statements are built with drizzle's `sql` tag (every value is bound) and
// run on the D1 binding itself: drizzle's D1 batch cannot take raw SQL that
// has parameters.
//
// Timestamps are epoch ms and are always bound from the caller's clock, never
// the database's, so a service's notion of "now" is the only one.

export type ObjectKind = "source" | "blob";
export type ObjectRef = { kind: ObjectKind; sha256: string };
export type SizedObjectRef = ObjectRef & { size: number };
export type UserObjectRef = ObjectRef & { userId: string };
export type SessionStatus = "pending" | "completed" | "aborted" | "expired";

export type SiteRow = {
  id: string;
  userId: string;
  clientWorkspaceId: string;
  name: string;
  slug: string;
  headVersion: number;
  allowRemix: boolean;
  liveFiles: string | null;
  protectedFiles: string | null;
  completeLock: string | null;
  completeLockExpiresAt: number | null;
  cleanupAfter: number | null;
  createdAt: number;
  updatedAt: number;
};

export type StoredObjectRow = SizedObjectRef & {
  userId: string;
  verified: boolean;
  deleting: boolean;
  createdAt: number;
};

export type SessionRow = {
  id: string;
  userId: string;
  siteId: string;
  baseVersion: number;
  status: SessionStatus;
  plan: string;
  resultVersion: number | null;
  expiresAt: number;
  holdUntil: number;
  createdAt: number;
};

export type VersionRow = {
  id: string;
  siteId: string;
  userId: string;
  version: number;
  sourceSha256: string;
  sourceSize: number;
  snapshotBytes: number;
  fileCount: number;
  siteFileCount: number;
  siteBytes: number;
  allowRemix: boolean;
  keep: boolean;
  publishSessionId: string;
  createdAt: number;
};

export type LargeFileRow = { path: string; sha256: string; size: number; mode: number };

export type NewSite = {
  id: string;
  userId: string;
  clientWorkspaceId: string;
  name: string;
  slug: string;
  allowRemix: boolean;
  now: number;
};

export type NewSession = {
  id: string;
  userId: string;
  siteId: string;
  baseVersion: number;
  plan: string;
  expiresAt: number;
  holdUntil: number;
  now: number;
  objects: SizedObjectRef[]; // every account object the plan needs
  cleanupAfter: number; // the site's next GC visit, at the latest
};

export type NewVersion = {
  id: string;
  siteId: string;
  userId: string;
  sessionId: string;
  baseVersion: number;
  source: { sha256: string; size: number };
  snapshotBytes: number;
  fileCount: number;
  siteFileCount: number;
  siteBytes: number;
  largeFiles: LargeFileRow[];
  liveFiles: string; // JSON string[]
  keepVersions: number;
  cleanupAfter: number;
  now: number;
};

export type CommitFailure =
  | { reason: "conflict" }
  | { reason: "objects-gone"; missing: ObjectRef[] }
  | { reason: "lock-lost" }
  | { reason: "other"; error: unknown };

export type PublishStore = {
  findSiteByWorkspace(userId: string, clientWorkspaceId: string): Promise<SiteRow | null>;
  findSiteById(siteId: string): Promise<SiteRow | null>;
  findSiteBySlug(slug: string): Promise<SiteRow | null>;
  countSites(userId: string): Promise<number>;
  // ON CONFLICT(user_id, client_workspace_id) DO NOTHING: "exists" means a
  // concurrent begin created the workspace's site first.
  insertSiteIfAbsent(site: NewSite): Promise<"inserted" | "exists" | "slug-taken">;
  updateSite(
    siteId: string,
    patch: { name?: string; allowRemix?: boolean },
    now: number,
  ): Promise<SiteRow | null>;

  getStoredObjects(userId: string, refs: ObjectRef[]): Promise<StoredObjectRow[]>;
  // Account objects that have a row, a session hold or a version reference
  // only through this session are released (row deleted) — for a begin that
  // was refused before it issued any URL. Returns the number deleted.
  releaseUnheldObjects(userId: string, refs: ObjectRef[], now: number): Promise<number>;

  // One batch: the session, its objects, the stored-object upsert and the
  // site's cleanup_after bump.
  createSession(session: NewSession): Promise<void>;
  getSession(sessionId: string): Promise<SessionRow | null>;
  setSessionStatus(
    sessionId: string,
    status: SessionStatus,
    opts?: { holdUntil?: number; onlyIfPending?: boolean },
  ): Promise<boolean>;
  usedBytes(userId: string): Promise<number>;

  // Takes the site's lock for a session against the expected head, when the
  // lock is free, lapsed, or already the session's own (a request of the
  // session that died without releasing it). The site row as claimed, or null.
  claimCompleteLock(claim: {
    siteId: string;
    sessionId: string;
    baseVersion: number;
    now: number;
    expiresAt: number;
  }): Promise<SiteRow | null>;
  // Sets protected_files while `lock` holds the site's lock (with at least
  // `fence.minRemainingMs` left, when given) and protected_files is still
  // `seenProtected`. False, changing nothing, otherwise.
  setProtectedFiles(p: {
    siteId: string;
    lock: string;
    protectedFiles: string;
    seenProtected: string | null;
    fence?: { now: number; minRemainingMs: number };
  }): Promise<boolean>;
  // True when `lock` holds the site's lock with at least `minRemainingMs` left.
  checkCompleteLock(
    siteId: string,
    lock: string,
    now: number,
    minRemainingMs: number,
  ): Promise<boolean>;
  releaseCompleteLock(siteId: string, lock: string): Promise<void>;
  commitVersion(version: NewVersion): Promise<{ ok: true } | ({ ok: false } & CommitFailure)>;
  missingSessionObjects(sessionId: string): Promise<ObjectRef[]>;

  getHeadVersion(site: Pick<SiteRow, "id" | "headVersion">): Promise<VersionRow | null>;
  getLargeFiles(versionId: string): Promise<LargeFileRow[]>;

  // GC
  expireSessions(now: number): Promise<number>;
  pruneVersions(keepVersions: number): Promise<number>;
  leftoverDeletingObjects(limit: number): Promise<UserObjectRef[]>;
  claimGcObjects(opts: {
    now: number;
    minCreatedAt: number;
    limit: number;
  }): Promise<UserObjectRef[]>;
  deleteObjectRows(keys: UserObjectRef[]): Promise<number>;
  sitesDueForCleanup(now: number, limit: number): Promise<SiteRow[]>;
  claimSiteLockForGc(
    siteId: string,
    lock: string,
    now: number,
    expiresAt: number,
  ): Promise<boolean>;
  heldSessionPlans(siteId: string, now: number): Promise<{ plan: string; holdUntil: number }[]>;
  finishSiteCleanup(
    siteId: string,
    lock: string,
    seen: number | null,
    next: number | null,
  ): Promise<void>;
  deleteOldSessions(now: number, createdBefore: number): Promise<number>;
  abandonedSites(now: number, createdBefore: number, limit: number): Promise<SiteRow[]>;
  deleteAbandonedSite(siteId: string, lock: string, now: number): Promise<boolean>;
};

// Rows per statement so `perRow` parameters a row, plus `fixed` parameters
// the statement binds once, stay within D1's limit.
export const chunk = <T>(rows: T[], perRow: number, fixed = 0): T[][] => {
  const size = Math.floor((D1_MAX_PARAMS - fixed) / perRow);
  if (size < 1) throw new Error(`a row of ${perRow} parameters cannot fit in one statement`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

type Raw = Record<string, unknown>;
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === 1 || v === true || v === "1";

const toSite = (r: Raw): SiteRow => ({
  id: String(r.id),
  userId: String(r.user_id),
  clientWorkspaceId: String(r.client_workspace_id),
  name: String(r.name),
  slug: String(r.slug),
  headVersion: num(r.head_version),
  allowRemix: bool(r.allow_remix),
  liveFiles: strOrNull(r.live_files),
  protectedFiles: strOrNull(r.protected_files),
  completeLock: strOrNull(r.complete_lock),
  completeLockExpiresAt: numOrNull(r.complete_lock_expires_at),
  cleanupAfter: numOrNull(r.cleanup_after),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

const toStoredObject = (r: Raw): StoredObjectRow => ({
  userId: String(r.user_id),
  kind: r.kind as ObjectKind,
  sha256: String(r.sha256),
  size: num(r.size),
  verified: bool(r.verified),
  deleting: bool(r.deleting),
  createdAt: num(r.created_at),
});

const toSession = (r: Raw): SessionRow => ({
  id: String(r.id),
  userId: String(r.user_id),
  siteId: String(r.site_id),
  baseVersion: num(r.base_version),
  status: r.status as SessionStatus,
  plan: String(r.plan),
  resultVersion: numOrNull(r.result_version),
  expiresAt: num(r.expires_at),
  holdUntil: num(r.hold_until),
  createdAt: num(r.created_at),
});

const toVersion = (r: Raw): VersionRow => ({
  id: String(r.id),
  siteId: String(r.site_id),
  userId: String(r.user_id),
  version: num(r.version),
  sourceSha256: String(r.source_sha256),
  sourceSize: num(r.source_size),
  snapshotBytes: num(r.snapshot_bytes),
  fileCount: num(r.file_count),
  siteFileCount: num(r.site_file_count),
  siteBytes: num(r.site_bytes),
  allowRemix: bool(r.allow_remix),
  keep: bool(r.keep),
  publishSessionId: String(r.publish_session_id),
  createdAt: num(r.created_at),
});

const toUserObject = (r: Raw): UserObjectRef => ({
  userId: String(r.user_id),
  kind: r.kind as ObjectKind,
  sha256: String(r.sha256),
});

// D1 errors surface wrapped (drizzle's "Failed query" with the driver error as
// its cause); the constraint name is in the cause.
const errorText = (error: unknown): string => {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    parts.push(e instanceof Error ? e.message : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(" | ");
};

const join = (parts: SQL[]) => sql.join(parts, sql`, `);
const values = <T>(rows: T[], row: (r: T) => SQL) => join(rows.map(row));
const bit = (b: boolean) => (b ? 1 : 0);

// A statement's live holds: sessions whose upload URLs still work.
const heldBySession = (so: SQL, now: number) => sql`EXISTS (
  SELECT 1 FROM publish_session_object pso JOIN publish_session ps ON ps.id = pso.session_id
  WHERE pso.user_id = ${so}.user_id AND pso.kind = ${so}.kind AND pso.sha256 = ${so}.sha256
    AND ps.hold_until > ${now})`;

const referencedByVersion = (so: SQL) => sql`(
  (${so}.kind = 'source' AND EXISTS (SELECT 1 FROM site_version v
     WHERE v.user_id = ${so}.user_id AND v.source_sha256 = ${so}.sha256))
  OR (${so}.kind = 'blob' AND EXISTS (SELECT 1 FROM version_large_file f
     WHERE f.user_id = ${so}.user_id AND f.sha256 = ${so}.sha256)))`;

const dialect = new SQLiteAsyncDialect();

export const d1PublishStore = (db: Db): PublishStore => {
  const d1 = db.$client;
  const prepare = (query: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(query);
    return d1.prepare(text).bind(...params);
  };
  const all = async (query: SQL) => (await prepare(query).all<Raw>()).results;
  const first = async (query: SQL) => (await all(query))[0] ?? null;
  const changes = async (query: SQL) => (await prepare(query).run()).meta.changes ?? 0;
  // One D1 batch: a single transaction, rolled back whole if any statement fails.
  const batch = async (queries: SQL[]) => {
    if (queries.length > 0) await d1.batch(queries.map(prepare));
  };

  const findSiteById = async (siteId: string) => {
    const row = await first(sql`SELECT * FROM site WHERE id = ${siteId}`);
    return row ? toSite(row) : null;
  };

  const missingSessionObjects = async (sessionId: string) =>
    (
      await all(sql`SELECT pso.kind, pso.sha256 FROM publish_session_object pso
        WHERE pso.session_id = ${sessionId} AND NOT EXISTS (
          SELECT 1 FROM stored_object so WHERE so.user_id = pso.user_id AND so.kind = pso.kind
            AND so.sha256 = pso.sha256 AND so.size = pso.size AND so.deleting = 0)
        ORDER BY pso.kind, pso.sha256`)
    ).map((r) => ({ kind: r.kind as ObjectKind, sha256: String(r.sha256) }));

  return {
    async findSiteByWorkspace(userId, clientWorkspaceId) {
      const row = await first(
        sql`SELECT * FROM site
          WHERE user_id = ${userId} AND client_workspace_id = ${clientWorkspaceId}`,
      );
      return row ? toSite(row) : null;
    },

    findSiteById,

    async findSiteBySlug(slug) {
      const row = await first(sql`SELECT * FROM site WHERE slug = ${slug}`);
      return row ? toSite(row) : null;
    },

    async countSites(userId) {
      const row = await first(sql`SELECT count(*) AS n FROM site WHERE user_id = ${userId}`);
      return num(row?.n ?? 0);
    },

    async insertSiteIfAbsent(site) {
      try {
        const inserted = await changes(sql`INSERT INTO site
            (id, user_id, client_workspace_id, name, slug, allow_remix, created_at, updated_at)
          VALUES (${site.id}, ${site.userId}, ${site.clientWorkspaceId}, ${site.name}, ${site.slug},
            ${bit(site.allowRemix)}, ${site.now}, ${site.now})
          ON CONFLICT(user_id, client_workspace_id) DO NOTHING`);
        return inserted > 0 ? "inserted" : "exists";
      } catch (error) {
        // The only unique violation the upsert leaves standing.
        if (/UNIQUE constraint failed: site\.slug/.test(errorText(error))) return "slug-taken";
        throw error;
      }
    },

    async updateSite(siteId, patch, now) {
      const sets: SQL[] = [];
      if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
      if (patch.allowRemix !== undefined) sets.push(sql`allow_remix = ${bit(patch.allowRemix)}`);
      if (sets.length === 0) return findSiteById(siteId);
      sets.push(sql`updated_at = ${now}`);
      const row = await first(sql`UPDATE site SET ${join(sets)} WHERE id = ${siteId} RETURNING *`);
      return row ? toSite(row) : null;
    },

    async getStoredObjects(userId, refs) {
      const rows: StoredObjectRow[] = [];
      for (const part of chunk(refs, 2, 1)) {
        const found = await all(sql`SELECT * FROM stored_object WHERE user_id = ${userId}
          AND (kind, sha256) IN (VALUES ${values(part, (r) => sql`(${r.kind}, ${r.sha256})`)})`);
        rows.push(...found.map(toStoredObject));
      }
      return rows;
    },

    async releaseUnheldObjects(userId, refs, now) {
      let released = 0;
      const so = sql.raw("stored_object");
      for (const part of chunk(refs, 2, 2)) {
        released += await changes(sql`DELETE FROM stored_object WHERE user_id = ${userId}
          AND verified = 0 AND deleting = 0
          AND (kind, sha256) IN (VALUES ${values(part, (r) => sql`(${r.kind}, ${r.sha256})`)})
          AND NOT ${referencedByVersion(so)} AND NOT ${heldBySession(so, now)}`);
      }
      return released;
    },

    async createSession(s) {
      const statements: SQL[] = [
        sql`INSERT INTO publish_session
            (id, user_id, site_id, base_version, status, plan, expires_at, hold_until, created_at)
          VALUES (${s.id}, ${s.userId}, ${s.siteId}, ${s.baseVersion}, 'pending', ${s.plan},
            ${s.expiresAt}, ${s.holdUntil}, ${s.now})`,
      ];
      for (const part of chunk(s.objects, 5)) {
        statements.push(sql`INSERT INTO publish_session_object
            (session_id, user_id, kind, sha256, size)
          VALUES ${values(part, (o) => sql`(${s.id}, ${s.userId}, ${o.kind}, ${o.sha256}, ${o.size})`)}`);
      }
      // An unverified row takes the largest size any begin declared: that is
      // what quota counts, and an upload URL signed for the larger size may
      // still be in use, so neither order of declarations can undercount (a
      // plan that declared the smaller size then fails complete's size
      // check). A verified row keeps its size (begin refused a mismatch), and
      // a row GC is deleting is left alone.
      for (const part of chunk(s.objects, 5)) {
        statements.push(sql`INSERT INTO stored_object
            (user_id, kind, sha256, size, verified, deleting, created_at)
          VALUES ${values(
            part,
            (o) => sql`(${s.userId}, ${o.kind}, ${o.sha256}, ${o.size}, 0, 0, ${s.now})`,
          )}
          ON CONFLICT(user_id, kind, sha256) DO UPDATE
            SET size = max(stored_object.size, excluded.size)
          WHERE stored_object.verified = 0 AND stored_object.deleting = 0`);
      }
      statements.push(sql`UPDATE site
        SET cleanup_after = max(coalesce(cleanup_after, 0), ${s.cleanupAfter})
        WHERE id = ${s.siteId}`);
      await batch(statements);
    },

    async getSession(sessionId) {
      const row = await first(sql`SELECT * FROM publish_session WHERE id = ${sessionId}`);
      return row ? toSession(row) : null;
    },

    async setSessionStatus(sessionId, status, opts = {}) {
      const sets = [sql`status = ${status}`];
      if (opts.holdUntil !== undefined) sets.push(sql`hold_until = ${opts.holdUntil}`);
      const onlyPending = opts.onlyIfPending ? sql` AND status = 'pending'` : sql``;
      return (
        (await changes(
          sql`UPDATE publish_session SET ${join(sets)} WHERE id = ${sessionId}${onlyPending}`,
        )) > 0
      );
    },

    // Every stored object GC has not claimed counts, committed or not, until
    // GC removes it (spec §10, Q10).
    async usedBytes(userId) {
      const row = await first(sql`SELECT COALESCE(SUM(size), 0) AS used FROM stored_object
        WHERE user_id = ${userId} AND deleting = 0`);
      return num(row?.used ?? 0);
    },

    async claimCompleteLock(c) {
      const row = await first(sql`UPDATE site SET complete_lock = ${c.sessionId},
          complete_lock_expires_at = ${c.expiresAt}
        WHERE id = ${c.siteId} AND head_version = ${c.baseVersion}
          AND (complete_lock IS NULL OR complete_lock_expires_at < ${c.now}
            OR complete_lock = ${c.sessionId})
        RETURNING *`);
      return row ? toSite(row) : null;
    },

    async setProtectedFiles(p) {
      const fence = p.fence
        ? sql` AND complete_lock_expires_at >= ${p.fence.now + p.fence.minRemainingMs}`
        : sql``;
      return (
        (await changes(sql`UPDATE site SET protected_files = ${p.protectedFiles}
          WHERE id = ${p.siteId} AND complete_lock = ${p.lock}
            AND protected_files IS ${p.seenProtected}${fence}`)) > 0
      );
    },

    async checkCompleteLock(siteId, lock, now, minRemainingMs) {
      const row = await first(sql`SELECT 1 AS held FROM site WHERE id = ${siteId}
        AND complete_lock = ${lock} AND complete_lock_expires_at >= ${now + minRemainingMs}`);
      return row !== null;
    },

    async releaseCompleteLock(siteId, lock) {
      await changes(sql`UPDATE site SET complete_lock = NULL, complete_lock_expires_at = NULL
        WHERE id = ${siteId} AND complete_lock = ${lock}`);
    },

    async commitVersion(v) {
      const next = v.baseVersion + 1;
      // A failed guard binds NULL into the NOT NULL source_sha256, so the
      // insert fails and D1 rolls the whole batch back. The unique index on
      // (site_id, version) is a second expected-version check.
      const guard = sql`EXISTS (SELECT 1 FROM site WHERE id = ${v.siteId}
            AND head_version = ${v.baseVersion} AND complete_lock = ${v.sessionId})
        AND NOT EXISTS (SELECT 1 FROM publish_session_object pso
          WHERE pso.session_id = ${v.sessionId}
          AND NOT EXISTS (SELECT 1 FROM stored_object so WHERE so.user_id = pso.user_id
            AND so.kind = pso.kind AND so.sha256 = pso.sha256 AND so.size = pso.size
            AND so.deleting = 0))`;
      const statements: SQL[] = [
        sql`INSERT INTO site_version (id, site_id, user_id, version, source_sha256, source_size,
            snapshot_bytes, file_count, site_file_count, site_bytes, allow_remix, publish_session_id,
            created_at)
          SELECT ${v.id}, ${v.siteId}, ${v.userId}, ${next},
            CASE WHEN ${guard} THEN ${v.source.sha256} ELSE NULL END,
            ${v.source.size}, ${v.snapshotBytes}, ${v.fileCount}, ${v.siteFileCount}, ${v.siteBytes},
            (SELECT allow_remix FROM site WHERE id = ${v.siteId}), ${v.sessionId}, ${v.now}`,
      ];
      for (const part of chunk(v.largeFiles, 6)) {
        statements.push(sql`INSERT INTO version_large_file
            (version_id, user_id, path, sha256, size, mode)
          VALUES ${values(
            part,
            (f) => sql`(${v.id}, ${v.userId}, ${f.path}, ${f.sha256}, ${f.size}, ${f.mode})`,
          )}`);
      }
      statements.push(
        sql`UPDATE stored_object SET verified = 1 WHERE deleting = 0 AND (user_id, kind, sha256) IN
          (SELECT user_id, kind, sha256 FROM publish_session_object
            WHERE session_id = ${v.sessionId})`,
        sql`UPDATE site SET head_version = ${next}, live_files = ${v.liveFiles}, protected_files = NULL,
            complete_lock = NULL, complete_lock_expires_at = NULL,
            cleanup_after = max(coalesce(cleanup_after, 0), ${v.cleanupAfter}), updated_at = ${v.now}
          WHERE id = ${v.siteId} AND head_version = ${v.baseVersion}
            AND complete_lock = ${v.sessionId}`,
        sql`UPDATE publish_session SET status = 'completed', result_version = ${next}
          WHERE id = ${v.sessionId}`,
        sql`DELETE FROM site_version WHERE site_id = ${v.siteId} AND keep = 0
          AND version <= ${next - v.keepVersions}`,
      );
      try {
        await batch(statements);
        return { ok: true };
      } catch (error) {
        const site = await findSiteById(v.siteId);
        if (!site || site.headVersion !== v.baseVersion) return { ok: false, reason: "conflict" };
        const missing = await missingSessionObjects(v.sessionId);
        if (missing.length > 0) return { ok: false, reason: "objects-gone", missing };
        if (site.completeLock !== v.sessionId) return { ok: false, reason: "lock-lost" };
        return { ok: false, reason: "other", error };
      }
    },

    missingSessionObjects,

    async getHeadVersion(site) {
      if (site.headVersion === 0) return null;
      const row = await first(sql`SELECT * FROM site_version
        WHERE site_id = ${site.id} AND version = ${site.headVersion}`);
      return row ? toVersion(row) : null;
    },

    async getLargeFiles(versionId) {
      return (
        await all(sql`SELECT path, sha256, size, mode FROM version_large_file
          WHERE version_id = ${versionId} ORDER BY path`)
      ).map((r) => ({
        path: String(r.path),
        sha256: String(r.sha256),
        size: num(r.size),
        mode: num(r.mode),
      }));
    },

    async expireSessions(now) {
      return changes(sql`UPDATE publish_session SET status = 'expired'
        WHERE status = 'pending' AND expires_at < ${now}`);
    },

    // RETURNING rather than meta.changes, which on D1 also counts the rows a
    // cascade removed.
    async pruneVersions(keepVersions) {
      return (
        await all(sql`DELETE FROM site_version WHERE keep = 0
          AND version <= (SELECT head_version FROM site WHERE site.id = site_version.site_id)
            - ${keepVersions}
          RETURNING id`)
      ).length;
    },

    async leftoverDeletingObjects(limit) {
      if (limit <= 0) return [];
      return (
        await all(
          sql`SELECT user_id, kind, sha256 FROM stored_object WHERE deleting = 1 LIMIT ${limit}`,
        )
      ).map(toUserObject);
    },

    // Selects and marks in one statement, so "unreferenced" and the mark are
    // atomic with respect to begin and commit. Never-verified objects nobody
    // holds skip the age floor: nothing was ever committed against them (Q10).
    async claimGcObjects({ now, minCreatedAt, limit }) {
      if (limit <= 0) return [];
      const so = sql.raw("so");
      return (
        await all(sql`UPDATE stored_object SET deleting = 1, verified = 0 WHERE rowid IN (
          SELECT so.rowid FROM stored_object so
          WHERE so.deleting = 0 AND (so.verified = 0 OR so.created_at < ${minCreatedAt})
            AND NOT ${referencedByVersion(so)} AND NOT ${heldBySession(so, now)}
          LIMIT ${limit})
        RETURNING user_id, kind, sha256`)
      ).map(toUserObject);
    },

    async deleteObjectRows(keys) {
      let deleted = 0;
      for (const part of chunk(keys, 3)) {
        deleted += await changes(sql`DELETE FROM stored_object WHERE deleting = 1
          AND (user_id, kind, sha256) IN
            (VALUES ${values(part, (k) => sql`(${k.userId}, ${k.kind}, ${k.sha256})`)})`);
      }
      return deleted;
    },

    async sitesDueForCleanup(now, limit) {
      return (
        await all(sql`SELECT * FROM site WHERE cleanup_after < ${now}
          ORDER BY cleanup_after LIMIT ${limit}`)
      ).map(toSite);
    },

    async claimSiteLockForGc(siteId, lock, now, expiresAt) {
      return (
        (await changes(sql`UPDATE site
          SET complete_lock = ${lock}, complete_lock_expires_at = ${expiresAt}
          WHERE id = ${siteId} AND (complete_lock IS NULL OR complete_lock_expires_at < ${now})`)) >
        0
      );
    },

    async heldSessionPlans(siteId, now) {
      return (
        await all(sql`SELECT plan, hold_until FROM publish_session
          WHERE site_id = ${siteId} AND hold_until > ${now}`)
      ).map((r) => ({ plan: String(r.plan), holdUntil: num(r.hold_until) }));
    },

    async finishSiteCleanup(siteId, lock, seen, next) {
      // `IS :seen` keeps a later schedule a begin or a commit wrote meanwhile.
      await batch([
        sql`UPDATE site SET complete_lock = NULL, complete_lock_expires_at = NULL
          WHERE id = ${siteId} AND complete_lock = ${lock}`,
        sql`UPDATE site SET cleanup_after = ${next}
          WHERE id = ${siteId} AND cleanup_after IS ${seen}`,
      ]);
    },

    async deleteOldSessions(now, createdBefore) {
      return (
        await all(sql`DELETE FROM publish_session WHERE status != 'pending'
          AND hold_until < ${now} AND created_at < ${createdBefore} RETURNING id`)
      ).length;
    },

    async abandonedSites(now, createdBefore, limit) {
      if (limit <= 0) return [];
      return (
        await all(sql`SELECT * FROM site WHERE head_version = 0 AND created_at < ${createdBefore}
          AND NOT EXISTS (SELECT 1 FROM publish_session ps WHERE ps.site_id = site.id
            AND ps.hold_until > ${now})
          ORDER BY created_at LIMIT ${limit}`)
      ).map(toSite);
    },

    async deleteAbandonedSite(siteId, lock, now) {
      return (
        (await changes(sql`DELETE FROM site WHERE id = ${siteId} AND head_version = 0
          AND complete_lock = ${lock}
          AND NOT EXISTS (SELECT 1 FROM publish_session ps WHERE ps.site_id = site.id
            AND ps.hold_until > ${now})`)) > 0
      );
    },
  };
};

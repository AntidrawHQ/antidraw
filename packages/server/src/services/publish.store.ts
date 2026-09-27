import { sql, type SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import { utf8Bytes } from "../lib/paths";
import {
  D1_JSON_PARAM_BYTES,
  D1_MAX_PARAMS,
  FILE_ROW_OVERHEAD_BYTES,
} from "../lib/publish-limits";

// Every D1 statement publish + remix + GC run, behind one structural type so
// services and tests can swap in src/test/memory-publish-store.ts. Raw SQL
// rather than the query builder: the guarded statements (the commit guard,
// the GC claim) need subqueries and row values the builder cannot express,
// and raw SQL keeps each statement's bound-parameter count visible (D1
// refuses more than 100 per statement, also inside a batch; see `chunk`).
// Statements over a site's worth of rows (up to 5 000 site contents) bind
// them as one JSON array instead, read back with json_each (`jsonChunks`), so
// a publish costs a few statements rather than hundreds.
// Statements are built with drizzle's `sql` tag (every value is bound) and
// run on the D1 binding itself: drizzle's D1 batch cannot take raw SQL that
// has parameters.
//
// Timestamps are epoch ms and are always bound from the caller's clock, never
// the database's, so a service's notion of "now" is the only one.

// "source" and "blob" live in SOURCES, "site" (a site file's content) in SITES.
export type ObjectKind = "source" | "blob" | "site";
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
  pointerVersion: number;
  completeLock: string | null;
  completeLockExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

// What GC's abandoned-site query returns: enough to claim the site and name
// its pointer.
export type SiteRef = Pick<SiteRow, "id" | "slug">;

// What a session's `plan` becomes once no complete can use it any more
// (committed, aborted, or its hold ended): the large part of the row is the
// plan.
export const PLAN_STUB = "{}";

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
  siteUploadBytes: number;
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
  fileRowBytes: number;
  allowRemix: boolean;
  keep: boolean;
  publishSessionId: string;
  createdAt: number;
};

export type LargeFileRow = { path: string; sha256: string; size: number; mode: number };
// `immutable`: the build named it by its content and it is at an
// isImmutableSitePath (lib/paths.ts). The pointer marks it "i", and only such
// rows of older versions are grace entries.
export type SiteFileRow = {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
  immutable: boolean;
};

// A version_site_file row's estimated D1 footprint, toward the account's
// MAX_FILE_ROW_BYTES. `siteFileRowWeight` below is the same sum in SQL.
export const siteFileRowBytes = (f: Pick<SiteFileRow, "path" | "contentType">) =>
  utf8Bytes(f.path) + utf8Bytes(f.contentType) + FILE_ROW_OVERHEAD_BYTES;
// A version_large_file row's, likewise. Its rows stay as long as the version.
export const largeFileRowBytes = (f: Pick<LargeFileRow, "path">) =>
  utf8Bytes(f.path) + FILE_ROW_OVERHEAD_BYTES;
// A site file of one of the site's versions, for building its pointer.
export type VersionSiteFileRow = SiteFileRow & { version: number };

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
  siteUploadBytes: number; // Σ size of its site contents no commit has verified
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
  siteFiles: SiteFileRow[];
  // Σ siteFileRowBytes over siteFiles plus Σ largeFileRowBytes over
  // largeFiles.
  fileRowBytes: number;
  keepVersions: number;
  now: number;
  // How many session objects the session was created with (its plan's
  // source, distinct blobs and distinct site contents). The guard requires them all still there, so
  // a session whose objects GC retired cannot commit whatever the clocks say.
  sessionObjects: number;
};

export type CommitFailure =
  | { reason: "conflict" }
  | { reason: "objects-gone"; missing: ObjectRef[] }
  | { reason: "lock-lost" }
  // The session is no longer pending, its hold ended, or its session objects
  // are gone: GC may already have claimed its objects and retired it.
  | { reason: "expired" }
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

  // One batch: the session, its objects and the stored-object upsert.
  createSession(session: NewSession): Promise<void>;
  // Deletes a session begin refused before it issued any URL or answered
  // with its id: nothing can complete it or read its plan, and a row kept
  // until retention would let refused begins fill D1 past the open-session
  // cap. Its session objects go with it.
  discardSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<SessionRow | null>;
  // `retire` does here what GC's retire would, for a session whose hold ends
  // here: its plan becomes PLAN_STUB and its session objects are deleted.
  // Otherwise both would stay in D1 until GC's next run, outside the
  // open-session cap. (A complete of it already in flight read the plan
  // before it took the lock, and its commit guard needs a pending session.)
  setSessionStatus(
    sessionId: string,
    status: SessionStatus,
    opts?: { holdUntil?: number; onlyIfPending?: boolean; retire?: boolean },
  ): Promise<boolean>;
  // The storage quota's use: every source and blob GC has not claimed.
  usedBytes(userId: string): Promise<number>;
  // Every site content of the account GC has not claimed, toward
  // MAX_STORED_SITE_BYTES.
  storedSiteBytes(userId: string): Promise<number>;
  // Σ file_row_bytes of the account's retained versions (their large-file
  // and site-file rows), toward MAX_FILE_ROW_BYTES.
  fileRowBytes(userId: string): Promise<number>;
  // The account's sessions that have not committed and still hold, and the
  // uncommitted site bytes they hold (their site_upload_bytes).
  openSessions(userId: string, now: number): Promise<{ count: number; siteUploadBytes: number }>;

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
  releaseCompleteLock(siteId: string, lock: string): Promise<void>;
  commitVersion(version: NewVersion): Promise<{ ok: true } | ({ ok: false } & CommitFailure)>;
  missingSessionObjects(sessionId: string): Promise<ObjectRef[]>;
  // The session objects an earlier complete of the session found in R2, and
  // recording more of them.
  presentSessionObjects(sessionId: string): Promise<ObjectRef[]>;
  markSessionObjectsPresent(sessionId: string, refs: ObjectRef[]): Promise<void>;

  getHeadVersion(site: Pick<SiteRow, "id" | "headVersion">): Promise<VersionRow | null>;
  getLargeFiles(versionId: string): Promise<LargeFileRow[]>;
  // The site files of the site's versions from `oldest` to `head`: every one
  // of the head, and of older versions only the immutable ones (their grace
  // entries). Newest version first.
  pointerFiles(siteId: string, head: number, oldest: number): Promise<VersionSiteFileRow[]>;
  // Records that the site's pointer is at `version` (never lowering it, nor
  // raising it past the head). The pointer only moves forward, so no pointer
  // will be at a version it moved past again: those versions' rows that no
  // grace entry can use are deleted in the same batch, and their
  // file_row_bytes lowered to match.
  setPointerVersion(siteId: string, version: number): Promise<void>;

  // GC. Where these ask whether a session has expired or still holds
  // (expires_at, hold_until against `now`), GC passes its hold cutoff as
  // `now`: its clock less GC_CLOCK_SKEW_MARGIN_MS (gc.service.ts).
  expireSessions(now: number): Promise<number>;
  pruneVersions(keepVersions: number): Promise<number>;
  leftoverDeletingObjects(limit: number): Promise<UserObjectRef[]>;
  // Round-robin across accounts: every account's oldest candidate before any
  // account's second, so one account's garbage cannot fill the claim.
  claimGcObjects(opts: {
    now: number;
    minCreatedAt: number;
    limit: number;
  }): Promise<UserObjectRef[]>;
  deleteObjectRows(keys: UserObjectRef[]): Promise<number>;
  // Sites whose pointer is behind their head version, longest waiting first.
  sitesBehindPointer(limit: number): Promise<SiteRow[]>;
  claimSiteLockForGc(
    siteId: string,
    lock: string,
    now: number,
    expiresAt: number,
  ): Promise<boolean>;
  // Sessions whose hold has ended: their held objects are dropped, their plan
  // stubbed and hold_until set to 0. At most `limit`.
  retireSessions(now: number, limit: number): Promise<number>;
  // Completed sessions created before `completedBefore`, and uncommitted ones
  // that expired before `uncommittedBefore`. At most `limit`.
  deleteOldSessions(opts: {
    now: number;
    completedBefore: number;
    uncommittedBefore: number;
    limit: number;
  }): Promise<number>;
  abandonedSites(now: number, createdBefore: number, limit: number): Promise<SiteRef[]>;
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

// Rows bound as JSON arrays of arrays, each at most D1_JSON_PARAM_BYTES, for
// statements that read them back with json_each: one bound value a chunk
// however many rows it holds.
export const jsonChunks = (rows: unknown[][], maxBytes = D1_JSON_PARAM_BYTES): string[] => {
  const out: string[] = [];
  let part: string[] = [];
  let bytes = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    const size = utf8Bytes(json) + 1;
    if (part.length > 0 && bytes + size > maxBytes) {
      out.push(`[${part.join(",")}]`);
      part = [];
      bytes = 2;
    }
    part.push(json);
    bytes += size;
  }
  if (part.length > 0) out.push(`[${part.join(",")}]`);
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
  pointerVersion: num(r.pointer_version ?? 0),
  completeLock: strOrNull(r.complete_lock),
  completeLockExpiresAt: numOrNull(r.complete_lock_expires_at),
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
  siteUploadBytes: num(r.site_upload_bytes ?? 0),
  createdAt: num(r.created_at),
});

const toSiteRef = (r: Raw): SiteRef => ({ id: String(r.id), slug: String(r.slug) });

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
  fileRowBytes: num(r.file_row_bytes ?? 0),
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
     WHERE f.user_id = ${so}.user_id AND f.sha256 = ${so}.sha256))
  OR (${so}.kind = 'site' AND EXISTS (SELECT 1 FROM version_site_file f
     WHERE f.user_id = ${so}.user_id AND f.sha256 = ${so}.sha256)))`;

// The version_site_file rows a pointer's grace entries may use: the immutable
// ones, as buildPointer takes them.
const graceCandidate = (f: SQL) => sql`(${f}.immutable = 1)`;
// siteFileRowBytes, in SQL. CAST AS BLOB: length() of a TEXT counts characters.
const siteFileRowWeight = (f: SQL) =>
  sql`(length(CAST(${f}.path AS BLOB)) + length(CAST(${f}.content_type AS BLOB))
    + ${FILE_ROW_OVERHEAD_BYTES})`;

// Column `i` of a json_each row (`j.value`, a JSON array).
const col = (i: number) => sql.raw(`json_extract(j.value, '$[${i}]')`);
// The (kind, sha256) pairs of `refs`, one JSON chunk each.
const refChunks = (refs: ObjectRef[]) => jsonChunks(refs.map((r) => [r.kind, r.sha256]));

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
  // One D1 batch: a single transaction, rolled back whole if any statement
  // fails. `batchEach` returns the rows each statement changed; `batch`, their sum.
  const batchEach = async (queries: SQL[]) => {
    if (queries.length === 0) return [];
    const results = await d1.batch(queries.map(prepare));
    return results.map((r) => r.meta?.changes ?? 0);
  };
  const batch = async (queries: SQL[]) => (await batchEach(queries)).reduce((sum, n) => sum + n, 0);

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
      for (const json of refChunks(refs)) {
        const found = await all(sql`SELECT * FROM stored_object WHERE user_id = ${userId}
          AND (kind, sha256) IN (SELECT ${col(0)}, ${col(1)} FROM json_each(${json}) j)`);
        rows.push(...found.map(toStoredObject));
      }
      return rows;
    },

    async releaseUnheldObjects(userId, refs, now) {
      let released = 0;
      const so = sql.raw("stored_object");
      for (const json of refChunks(refs)) {
        released += await changes(sql`DELETE FROM stored_object WHERE user_id = ${userId}
          AND verified = 0 AND deleting = 0
          AND (kind, sha256) IN (SELECT ${col(0)}, ${col(1)} FROM json_each(${json}) j)
          AND NOT ${referencedByVersion(so)} AND NOT ${heldBySession(so, now)}`);
      }
      return released;
    },

    async createSession(s) {
      const statements: SQL[] = [
        sql`INSERT INTO publish_session
            (id, user_id, site_id, base_version, status, plan, expires_at, hold_until,
             site_upload_bytes, created_at)
          VALUES (${s.id}, ${s.userId}, ${s.siteId}, ${s.baseVersion}, 'pending', ${s.plan},
            ${s.expiresAt}, ${s.holdUntil}, ${s.siteUploadBytes}, ${s.now})`,
      ];
      const objects = jsonChunks(s.objects.map((o) => [o.kind, o.sha256, o.size]));
      for (const json of objects) {
        statements.push(sql`INSERT INTO publish_session_object
            (session_id, user_id, kind, sha256, size)
          SELECT ${s.id}, ${s.userId}, ${col(0)}, ${col(1)}, ${col(2)} FROM json_each(${json}) j`);
      }
      // An unverified row takes the largest size any begin declared: that is
      // what quota counts, and an upload URL signed for the larger size may
      // still be in use, so neither order of declarations can undercount (a
      // plan that declared the smaller size then fails complete's size
      // check). A verified row keeps its size (begin refused a mismatch), and
      // a row GC is deleting is left alone. (`WHERE true` is SQLite's rule
      // for an upsert whose rows come from a SELECT.)
      for (const json of objects) {
        statements.push(sql`INSERT INTO stored_object
            (user_id, kind, sha256, size, verified, deleting, created_at)
          SELECT ${s.userId}, ${col(0)}, ${col(1)}, ${col(2)}, 0, 0, ${s.now}
            FROM json_each(${json}) j WHERE true
          ON CONFLICT(user_id, kind, sha256) DO UPDATE
            SET size = max(stored_object.size, excluded.size)
          WHERE stored_object.verified = 0 AND stored_object.deleting = 0`);
      }
      await batch(statements);
    },

    async discardSession(sessionId) {
      await batch([
        sql`DELETE FROM publish_session_object WHERE session_id = ${sessionId}`,
        sql`DELETE FROM publish_session WHERE id = ${sessionId}`,
      ]);
    },

    async getSession(sessionId) {
      const row = await first(sql`SELECT * FROM publish_session WHERE id = ${sessionId}`);
      return row ? toSession(row) : null;
    },

    async setSessionStatus(sessionId, status, opts = {}) {
      const sets = [sql`status = ${status}`];
      if (opts.holdUntil !== undefined) sets.push(sql`hold_until = ${opts.holdUntil}`);
      if (opts.retire) sets.push(sql`plan = ${PLAN_STUB}`);
      const onlyPending = opts.onlyIfPending ? sql` AND status = 'pending'` : sql``;
      const updated =
        (await changes(
          sql`UPDATE publish_session SET ${join(sets)} WHERE id = ${sessionId}${onlyPending}`,
        )) > 0;
      // Should this fail, GC's retire deletes them once the hold has ended.
      if (updated && opts.retire) {
        await changes(sql`DELETE FROM publish_session_object WHERE session_id = ${sessionId}`);
      }
      return updated;
    },

    // Every source and blob GC has not claimed counts, committed or not,
    // until GC removes it (spec §10, Q10). Site contents are outside the quota.
    async usedBytes(userId) {
      const row = await first(sql`SELECT COALESCE(SUM(size), 0) AS used FROM stored_object
        WHERE user_id = ${userId} AND kind IN ('source', 'blob') AND deleting = 0`);
      return num(row?.used ?? 0);
    },

    // On the primary key, like usedBytes.
    async storedSiteBytes(userId) {
      const row = await first(sql`SELECT COALESCE(SUM(size), 0) AS used FROM stored_object
        WHERE user_id = ${userId} AND kind = 'site' AND deleting = 0`);
      return num(row?.used ?? 0);
    },

    async fileRowBytes(userId) {
      const row = await first(sql`SELECT COALESCE(SUM(file_row_bytes), 0) AS bytes
        FROM site_version WHERE user_id = ${userId}`);
      return num(row?.bytes ?? 0);
    },

    async openSessions(userId, now) {
      const row = await first(sql`SELECT count(*) AS n,
          COALESCE(SUM(site_upload_bytes), 0) AS bytes
        FROM publish_session WHERE user_id = ${userId}
          AND status IN ('pending', 'aborted', 'expired') AND hold_until > ${now}`);
      return { count: num(row?.n ?? 0), siteUploadBytes: num(row?.bytes ?? 0) };
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

    async releaseCompleteLock(siteId, lock) {
      await changes(sql`UPDATE site SET complete_lock = NULL, complete_lock_expires_at = NULL
        WHERE id = ${siteId} AND complete_lock = ${lock}`);
    },

    async commitVersion(v) {
      const next = v.baseVersion + 1;
      // A failed guard binds NULL into the NOT NULL source_sha256, so the
      // insert fails and D1 rolls the whole batch back. The unique index on
      // (site_id, version) is a second expected-version check. The session
      // must still be pending and holding: once its hold ends, GC may claim
      // its unverified objects and retire (delete) its session objects, after
      // which the object check below would pass with nothing to check. The
      // hold is judged by this Worker's clock and GC's claim by GC's, so the
      // session objects must also all still be there: that check needs no
      // clock.
      const guard = sql`EXISTS (SELECT 1 FROM site WHERE id = ${v.siteId}
            AND head_version = ${v.baseVersion} AND complete_lock = ${v.sessionId})
        AND EXISTS (SELECT 1 FROM publish_session WHERE id = ${v.sessionId}
            AND status = 'pending' AND hold_until > ${v.now})
        AND (SELECT count(*) FROM publish_session_object
            WHERE session_id = ${v.sessionId}) = ${v.sessionObjects}
        AND NOT EXISTS (SELECT 1 FROM publish_session_object pso
          WHERE pso.session_id = ${v.sessionId}
          AND NOT EXISTS (SELECT 1 FROM stored_object so WHERE so.user_id = pso.user_id
            AND so.kind = pso.kind AND so.sha256 = pso.sha256 AND so.size = pso.size
            AND so.deleting = 0))`;
      const statements: SQL[] = [
        sql`INSERT INTO site_version (id, site_id, user_id, version, source_sha256, source_size,
            snapshot_bytes, file_count, site_file_count, site_bytes, file_row_bytes,
            allow_remix, publish_session_id, created_at)
          SELECT ${v.id}, ${v.siteId}, ${v.userId}, ${next},
            CASE WHEN ${guard} THEN ${v.source.sha256} ELSE NULL END,
            ${v.source.size}, ${v.snapshotBytes}, ${v.fileCount}, ${v.siteFileCount}, ${v.siteBytes},
            ${v.fileRowBytes}, (SELECT allow_remix FROM site WHERE id = ${v.siteId}),
            ${v.sessionId}, ${v.now}`,
      ];
      for (const part of chunk(v.largeFiles, 6)) {
        statements.push(sql`INSERT INTO version_large_file
            (version_id, user_id, path, sha256, size, mode)
          VALUES ${values(
            part,
            (f) => sql`(${v.id}, ${v.userId}, ${f.path}, ${f.sha256}, ${f.size}, ${f.mode})`,
          )}`);
      }
      for (const json of jsonChunks(
        v.siteFiles.map((f) => [f.path, f.sha256, f.size, f.contentType, f.immutable ? 1 : 0]),
      )) {
        statements.push(sql`INSERT INTO version_site_file
            (version_id, user_id, path, sha256, size, content_type, immutable)
          SELECT ${v.id}, ${v.userId}, ${col(0)}, ${col(1)}, ${col(2)}, ${col(3)}, ${col(4)}
            FROM json_each(${json}) j`);
      }
      statements.push(
        // GC's age floor for a verified object runs from its last commit, so
        // it outlasts every upload URL the committing session was given
        // (UPLOAD_URL_TTL_S): the hold that kept GC off them ends here.
        sql`UPDATE stored_object SET verified = 1, created_at = max(created_at, ${v.now})
          WHERE deleting = 0 AND (user_id, kind, sha256) IN
            (SELECT user_id, kind, sha256 FROM publish_session_object
              WHERE session_id = ${v.sessionId})`,
        sql`UPDATE site SET head_version = ${next},
            complete_lock = NULL, complete_lock_expires_at = NULL, updated_at = ${v.now}
          WHERE id = ${v.siteId} AND head_version = ${v.baseVersion}
            AND complete_lock = ${v.sessionId}`,
        // The commit retires the session, as GC would once its hold ended:
        // nothing reads its plan again, and every object it held is verified
        // and referenced by the new version (and, once that is pruned, kept
        // by the age floor), so it holds nothing. Kept until then, its
        // session objects (one per plan object, up to ~6 000) would pile up
        // outside the open-session cap at the rate limit.
        sql`UPDATE publish_session SET status = 'completed', result_version = ${next},
            plan = ${PLAN_STUB}, hold_until = 0
          WHERE id = ${v.sessionId}`,
        sql`DELETE FROM publish_session_object WHERE session_id = ${v.sessionId}`,
        sql`DELETE FROM site_version WHERE site_id = ${v.siteId} AND keep = 0
          AND version <= ${next - v.keepVersions}`,
        // A completed session goes with its version, so a site keeps about
        // as many as it keeps versions rather than every commit for
        // GC_SESSION_RETENTION_MS.
        sql`DELETE FROM publish_session WHERE site_id = ${v.siteId} AND status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM site_version sv
            WHERE sv.site_id = publish_session.site_id
              AND sv.version = publish_session.result_version)`,
      );
      try {
        await batch(statements);
        return { ok: true };
      } catch (error) {
        const site = await findSiteById(v.siteId);
        if (!site || site.headVersion !== v.baseVersion) return { ok: false, reason: "conflict" };
        const session = await first(sql`SELECT 1 AS live FROM publish_session
          WHERE id = ${v.sessionId} AND status = 'pending' AND hold_until > ${v.now}
            AND (SELECT count(*) FROM publish_session_object
              WHERE session_id = ${v.sessionId}) = ${v.sessionObjects}`);
        if (!session) return { ok: false, reason: "expired" };
        const missing = await missingSessionObjects(v.sessionId);
        if (missing.length > 0) return { ok: false, reason: "objects-gone", missing };
        if (site.completeLock !== v.sessionId) return { ok: false, reason: "lock-lost" };
        return { ok: false, reason: "other", error };
      }
    },

    missingSessionObjects,

    async presentSessionObjects(sessionId) {
      return (
        await all(sql`SELECT kind, sha256 FROM publish_session_object
          WHERE session_id = ${sessionId} AND present = 1`)
      ).map((r) => ({ kind: r.kind as ObjectKind, sha256: String(r.sha256) }));
    },

    async markSessionObjectsPresent(sessionId, refs) {
      await batch(
        refChunks(refs).map(
          (json) => sql`UPDATE publish_session_object SET present = 1
            WHERE session_id = ${sessionId}
              AND (kind, sha256) IN (SELECT ${col(0)}, ${col(1)} FROM json_each(${json}) j)`,
        ),
      );
    },

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

    async pointerFiles(siteId, head, oldest) {
      return (
        await all(sql`SELECT v.version, f.path, f.sha256, f.size, f.content_type, f.immutable
          FROM site_version v JOIN version_site_file f ON f.version_id = v.id
          WHERE v.site_id = ${siteId} AND v.version BETWEEN ${oldest} AND ${head}
            AND (v.version = ${head} OR ${graceCandidate(sql.raw("f"))})
          ORDER BY v.version DESC, f.path`)
      ).map((r) => ({
        version: num(r.version),
        path: String(r.path),
        sha256: String(r.sha256),
        size: num(r.size),
        contentType: String(r.content_type),
        immutable: bool(r.immutable),
      }));
    },

    // The versions the pointer moves past: from where it was up to where it
    // now is. Earlier ones were pruned when it moved past them.
    async setPointerVersion(siteId, version) {
      const at = sql`(SELECT pointer_version FROM site WHERE id = ${siteId})`;
      const to = sql`min((SELECT head_version FROM site WHERE id = ${siteId}), max(${at}, ${version}))`;
      const passed = sql`site_id = ${siteId} AND version >= ${at} AND version < ${to}`;
      const f = sql.raw("version_site_file");
      await batch([
        sql`UPDATE site_version SET file_row_bytes = max(0, file_row_bytes
            - (SELECT COALESCE(SUM(${siteFileRowWeight(f)}), 0) FROM version_site_file
                WHERE version_site_file.version_id = site_version.id
                  AND NOT ${graceCandidate(f)}))
          WHERE ${passed}`,
        sql`DELETE FROM version_site_file
          WHERE version_id IN (SELECT id FROM site_version WHERE ${passed})
            AND NOT ${graceCandidate(f)}`,
        sql`UPDATE site SET pointer_version = ${to} WHERE id = ${siteId}`,
      ]);
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
    // `turn` numbers each account's candidates oldest first; taking turns in
    // order shares the claim across accounts.
    async claimGcObjects({ now, minCreatedAt, limit }) {
      if (limit <= 0) return [];
      const so = sql.raw("so");
      return (
        await all(sql`UPDATE stored_object SET deleting = 1, verified = 0 WHERE rowid IN (
          SELECT rid FROM (
            SELECT so.rowid AS rid, so.created_at AS created,
              row_number() OVER (PARTITION BY so.user_id ORDER BY so.created_at, so.rowid) AS turn
            FROM stored_object so
            WHERE so.deleting = 0 AND (so.verified = 0 OR so.created_at < ${minCreatedAt})
              AND NOT ${referencedByVersion(so)} AND NOT ${heldBySession(so, now)})
          ORDER BY turn, created, rid
          LIMIT ${limit})
        RETURNING user_id, kind, sha256`)
      ).map(toUserObject);
    },

    // One D1 batch. `+deleting` keeps the planner on the primary key: the
    // partial index would have it walk every row GC has marked.
    async deleteObjectRows(keys) {
      return batch(
        chunk(keys, 3).map(
          (part) => sql`DELETE FROM stored_object WHERE +deleting = 1
            AND (user_id, kind, sha256) IN
              (VALUES ${values(part, (k) => sql`(${k.userId}, ${k.kind}, ${k.sha256})`)})`,
        ),
      );
    },

    async sitesBehindPointer(limit) {
      if (limit <= 0) return [];
      return (
        await all(sql`SELECT * FROM site WHERE pointer_version < head_version
          ORDER BY updated_at, id LIMIT ${limit}`)
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

    async retireSessions(now, limit) {
      const ids = (
        await all(sql`SELECT id FROM publish_session
          WHERE hold_until > 0 AND hold_until < ${now} LIMIT ${Math.min(limit, 97)}`)
      ).map((r) => String(r.id));
      if (ids.length === 0) return 0;
      const idList = join(ids.map((id) => sql`${id}`));
      await batch([
        sql`DELETE FROM publish_session_object WHERE session_id IN (${idList})`,
        sql`UPDATE publish_session SET hold_until = 0, plan = ${PLAN_STUB}
          WHERE id IN (${idList}) AND hold_until > 0 AND hold_until < ${now}`,
      ]);
      return ids.length;
    },

    async deleteOldSessions({ now, completedBefore, uncommittedBefore, limit }) {
      return (
        await all(sql`DELETE FROM publish_session WHERE id IN (
          SELECT ps.id FROM publish_session ps WHERE ps.hold_until < ${now} AND (
            (ps.status = 'completed' AND ps.created_at < ${completedBefore})
            OR (ps.status != 'completed' AND ps.expires_at < ${uncommittedBefore}))
          LIMIT ${limit})
        RETURNING id`)
      ).length;
    },

    async abandonedSites(now, createdBefore, limit) {
      if (limit <= 0) return [];
      return (
        await all(sql`SELECT id, slug FROM site
          WHERE head_version = 0 AND created_at < ${createdBefore}
          AND NOT EXISTS (SELECT 1 FROM publish_session ps WHERE ps.site_id = site.id
            AND ps.hold_until > ${now})
          ORDER BY created_at LIMIT ${limit}`)
      ).map(toSiteRef);
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

// An in-memory PublishStore with the same semantics as d1PublishStore's SQL:
// the unique constraints, the cascades, the guarded all-or-nothing commit,
// the GC claim's conditions. Service tests run against it (and against the
// D1 store over node:sqlite where that is available), so a divergence between
// the two shows up as a test that passes on one and fails on the other.
import {
  PLAN_STUB,
  type CommitFailure,
  type LargeFileRow,
  type ObjectRef,
  type PublishStore,
  type SessionRow,
  type SiteRow,
  type StoredObjectRow,
  type UserObjectRef,
  type VersionRow,
} from "../services/publish.store";

type SessionObject = {
  sessionId: string;
  userId: string;
  kind: ObjectRef["kind"];
  sha256: string;
  size: number;
};
type LargeFile = LargeFileRow & { versionId: string; userId: string };

export type MemoryPublishState = {
  sites: Map<string, SiteRow>;
  versions: VersionRow[];
  largeFiles: LargeFile[];
  objects: Map<string, StoredObjectRow>;
  sessions: Map<string, SessionRow>;
  sessionObjects: SessionObject[];
};

const objectId = (o: { userId: string; kind: string; sha256: string }) =>
  `${o.userId}|${o.kind}|${o.sha256}`;

export const memoryPublishStore = (): PublishStore & { state: MemoryPublishState } => {
  const state: MemoryPublishState = {
    sites: new Map(),
    versions: [],
    largeFiles: [],
    objects: new Map(),
    sessions: new Map(),
    sessionObjects: [],
  };
  const copy = <T>(row: T | undefined | null): T | null => (row ? { ...row } : null);

  const deleteVersions = (keep: (v: VersionRow) => boolean) => {
    const gone = new Set(state.versions.filter((v) => !keep(v)).map((v) => v.id));
    state.versions = state.versions.filter((v) => !gone.has(v.id));
    state.largeFiles = state.largeFiles.filter((f) => !gone.has(f.versionId));
    return gone.size;
  };
  const deleteSessions = (drop: (s: SessionRow) => boolean) => {
    const gone = new Set([...state.sessions.values()].filter(drop).map((s) => s.id));
    for (const id of gone) state.sessions.delete(id);
    state.sessionObjects = state.sessionObjects.filter((o) => !gone.has(o.sessionId));
    return gone.size;
  };

  const referencedByVersion = (o: { userId: string; kind: string; sha256: string }) =>
    o.kind === "source"
      ? state.versions.some((v) => v.userId === o.userId && v.sourceSha256 === o.sha256)
      : state.largeFiles.some((f) => f.userId === o.userId && f.sha256 === o.sha256);
  const heldBySession = (o: { userId: string; kind: string; sha256: string }, now: number) =>
    state.sessionObjects.some(
      (so) =>
        so.userId === o.userId &&
        so.kind === o.kind &&
        so.sha256 === o.sha256 &&
        (state.sessions.get(so.sessionId)?.holdUntil ?? 0) > now,
    );

  const missingSessionObjects = async (sessionId: string) =>
    state.sessionObjects
      .filter((so) => so.sessionId === sessionId)
      .filter((so) => {
        const row = state.objects.get(objectId(so));
        return !row || row.size !== so.size || row.deleting;
      })
      .map((so) => ({ kind: so.kind, sha256: so.sha256 }))
      .sort((a, b) => (a.kind + a.sha256 < b.kind + b.sha256 ? -1 : 1));

  const lockFree = (site: SiteRow, now: number) =>
    site.completeLock === null || (site.completeLockExpiresAt ?? 0) < now;
  const starred = (siteId: string) => state.sites.get(siteId)?.protectedFiles === "*";
  const ref = (s: SiteRow) => ({ id: s.id, slug: s.slug });

  const store: PublishStore & { state: MemoryPublishState } = {
    state,

    async findSiteByWorkspace(userId, clientWorkspaceId) {
      return copy(
        [...state.sites.values()].find(
          (s) => s.userId === userId && s.clientWorkspaceId === clientWorkspaceId,
        ),
      );
    },
    async findSiteById(siteId) {
      return copy(state.sites.get(siteId));
    },
    async findSiteBySlug(slug) {
      return copy([...state.sites.values()].find((s) => s.slug === slug));
    },
    async countSites(userId) {
      return [...state.sites.values()].filter((s) => s.userId === userId).length;
    },
    async insertSiteIfAbsent(site) {
      const sites = [...state.sites.values()];
      if (
        sites.some(
          (s) => s.userId === site.userId && s.clientWorkspaceId === site.clientWorkspaceId,
        )
      ) {
        return "exists";
      }
      if (sites.some((s) => s.slug === site.slug)) return "slug-taken";
      state.sites.set(site.id, {
        id: site.id,
        userId: site.userId,
        clientWorkspaceId: site.clientWorkspaceId,
        name: site.name,
        slug: site.slug,
        headVersion: 0,
        allowRemix: site.allowRemix,
        liveFiles: null,
        liveEntries: null,
        protectedFiles: null,
        completeLock: null,
        completeLockExpiresAt: null,
        cleanupAfter: null,
        cleanupSince: null,
        createdAt: site.now,
        updatedAt: site.now,
      });
      return "inserted";
    },
    async updateSite(siteId, patch, now) {
      const site = state.sites.get(siteId);
      if (!site) return null;
      if (patch.name === undefined && patch.allowRemix === undefined) return copy(site);
      if (patch.name !== undefined) site.name = patch.name;
      if (patch.allowRemix !== undefined) site.allowRemix = patch.allowRemix;
      site.updatedAt = now;
      return copy(site);
    },

    async getStoredObjects(userId, refs) {
      return refs
        .map((r) => state.objects.get(objectId({ userId, ...r })))
        .filter((r): r is StoredObjectRow => !!r)
        .map((r) => ({ ...r }));
    },
    async releaseUnheldObjects(userId, refs, now) {
      let released = 0;
      for (const r of refs) {
        const id = objectId({ userId, ...r });
        const row = state.objects.get(id);
        if (!row || row.verified || row.deleting) continue;
        if (referencedByVersion(row) || heldBySession(row, now)) continue;
        state.objects.delete(id);
        released++;
      }
      return released;
    },

    async createSession(s) {
      if (state.sessions.has(s.id)) throw new Error("UNIQUE constraint failed: publish_session.id");
      state.sessions.set(s.id, {
        id: s.id,
        userId: s.userId,
        siteId: s.siteId,
        baseVersion: s.baseVersion,
        status: "pending",
        plan: s.plan,
        resultVersion: null,
        expiresAt: s.expiresAt,
        holdUntil: s.holdUntil,
        siteUploadBytes: s.siteUploadBytes,
        createdAt: s.now,
      });
      for (const o of s.objects) {
        state.sessionObjects.push({ sessionId: s.id, userId: s.userId, ...o });
        const id = objectId({ userId: s.userId, ...o });
        const row = state.objects.get(id);
        if (!row) {
          state.objects.set(id, {
            userId: s.userId,
            ...o,
            verified: false,
            deleting: false,
            createdAt: s.now,
          });
        } else if (!row.verified && !row.deleting) {
          row.size = Math.max(row.size, o.size);
        }
      }
      const site = state.sites.get(s.siteId);
      if (site) {
        site.cleanupAfter = Math.max(site.cleanupAfter ?? 0, s.cleanupAfter);
        site.cleanupSince ??= s.now;
      }
    },
    async discardSession(sessionId) {
      deleteSessions((s) => s.id === sessionId);
    },
    async getSession(sessionId) {
      return copy(state.sessions.get(sessionId));
    },
    async setSessionStatus(sessionId, status, opts = {}) {
      const session = state.sessions.get(sessionId);
      if (!session || (opts.onlyIfPending && session.status !== "pending")) return false;
      session.status = status;
      if (opts.holdUntil !== undefined) session.holdUntil = opts.holdUntil;
      const site = state.sites.get(session.siteId);
      const planNeeded = site?.protectedFiles === "*" || site?.completeLock === session.id;
      if (opts.stubPlan && !planNeeded) session.plan = PLAN_STUB;
      return true;
    },
    async usedBytes(userId) {
      return [...state.objects.values()]
        .filter((o) => o.userId === userId && !o.deleting)
        .reduce((sum, o) => sum + o.size, 0);
    },
    async openSessions(userId, now) {
      const open = [...state.sessions.values()].filter(
        (s) => s.userId === userId && s.status !== "completed" && s.holdUntil > now,
      );
      return {
        count: open.length,
        siteUploadBytes: open.reduce((sum, s) => sum + s.siteUploadBytes, 0),
      };
    },

    async claimCompleteLock(c) {
      const site = state.sites.get(c.siteId);
      if (
        !site ||
        site.headVersion !== c.baseVersion ||
        !(lockFree(site, c.now) || site.completeLock === c.sessionId)
      ) {
        return null;
      }
      site.completeLock = c.sessionId;
      site.completeLockExpiresAt = c.expiresAt;
      return copy(site);
    },
    async setProtectedFiles(p) {
      const site = state.sites.get(p.siteId);
      if (
        !site ||
        site.completeLock !== p.lock ||
        site.protectedFiles !== p.seenProtected ||
        (p.fence &&
          (site.completeLockExpiresAt ?? 0) < p.fence.now + p.fence.minRemainingMs)
      ) {
        return false;
      }
      site.protectedFiles = p.protectedFiles;
      return true;
    },
    async checkCompleteLock(siteId, lock, now, minRemainingMs) {
      const site = state.sites.get(siteId);
      return (
        !!site &&
        site.completeLock === lock &&
        (site.completeLockExpiresAt ?? 0) >= now + minRemainingMs
      );
    },
    async releaseCompleteLock(siteId, lock) {
      const site = state.sites.get(siteId);
      if (site && site.completeLock === lock) {
        site.completeLock = null;
        site.completeLockExpiresAt = null;
      }
    },
    async commitVersion(v): Promise<{ ok: true } | ({ ok: false } & CommitFailure)> {
      const site = state.sites.get(v.siteId);
      const next = v.baseVersion + 1;
      const current = state.sessions.get(v.sessionId);
      const live =
        !!current &&
        current.status === "pending" &&
        current.holdUntil > v.now &&
        state.sessionObjects.filter((o) => o.sessionId === v.sessionId).length ===
          v.sessionObjects;
      const guard =
        !!site &&
        site.headVersion === v.baseVersion &&
        site.completeLock === v.sessionId &&
        live &&
        (await missingSessionObjects(v.sessionId)).length === 0;
      const duplicate = state.versions.some((x) => x.siteId === v.siteId && x.version === next);
      if (!guard || duplicate || !site) {
        if (!site || site.headVersion !== v.baseVersion) return { ok: false, reason: "conflict" };
        if (!live) return { ok: false, reason: "expired" };
        const missing = await missingSessionObjects(v.sessionId);
        if (missing.length > 0) return { ok: false, reason: "objects-gone", missing };
        if (site.completeLock !== v.sessionId) return { ok: false, reason: "lock-lost" };
        return { ok: false, reason: "other", error: new Error("UNIQUE constraint failed") };
      }
      state.versions.push({
        id: v.id,
        siteId: v.siteId,
        userId: v.userId,
        version: next,
        sourceSha256: v.source.sha256,
        sourceSize: v.source.size,
        snapshotBytes: v.snapshotBytes,
        fileCount: v.fileCount,
        siteFileCount: v.siteFileCount,
        siteBytes: v.siteBytes,
        allowRemix: site.allowRemix,
        keep: false,
        publishSessionId: v.sessionId,
        createdAt: v.now,
      });
      for (const f of v.largeFiles)
        state.largeFiles.push({ ...f, versionId: v.id, userId: v.userId });
      for (const so of state.sessionObjects.filter((o) => o.sessionId === v.sessionId)) {
        const row = state.objects.get(objectId(so));
        if (row && !row.deleting) row.verified = true;
      }
      site.headVersion = next;
      site.liveFiles = v.liveFiles;
      site.liveEntries = v.liveEntries;
      site.protectedFiles = null;
      site.completeLock = null;
      site.completeLockExpiresAt = null;
      site.cleanupAfter = Math.max(site.cleanupAfter ?? 0, v.cleanupAfter);
      site.cleanupSince ??= v.now;
      site.updatedAt = v.now;
      const session = state.sessions.get(v.sessionId);
      if (session) {
        session.status = "completed";
        session.resultVersion = next;
        session.plan = PLAN_STUB;
      }
      deleteVersions(
        (x) => !(x.siteId === v.siteId && !x.keep && x.version <= next - v.keepVersions),
      );
      return { ok: true };
    },
    missingSessionObjects,

    async getHeadVersion(site) {
      if (site.headVersion === 0) return null;
      return copy(
        state.versions.find((v) => v.siteId === site.id && v.version === site.headVersion),
      );
    },
    async getLargeFiles(versionId) {
      return state.largeFiles
        .filter((f) => f.versionId === versionId)
        .map(({ path, sha256, size, mode }) => ({ path, sha256, size, mode }))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },

    async expireSessions(now) {
      let n = 0;
      for (const s of state.sessions.values()) {
        if (s.status === "pending" && s.expiresAt < now) {
          s.status = "expired";
          n++;
        }
      }
      return n;
    },
    async pruneVersions(keepVersions) {
      return deleteVersions((v) => {
        const head = state.sites.get(v.siteId)?.headVersion ?? 0;
        return v.keep || v.version > head - keepVersions;
      });
    },
    async leftoverDeletingObjects(limit) {
      return [...state.objects.values()]
        .filter((o) => o.deleting)
        .slice(0, Math.max(limit, 0))
        .map(({ userId, kind, sha256 }) => ({ userId, kind, sha256 }));
    },
    async claimGcObjects({ now, minCreatedAt, limit }) {
      if (limit <= 0) return [];
      const rows = [...state.objects.values()];
      const turns = new Map<string, number>();
      const candidates = rows
        .map((o, rowid) => ({ o, rowid }))
        .filter(
          ({ o }) =>
            !o.deleting &&
            !(o.verified && o.createdAt >= minCreatedAt) &&
            !referencedByVersion(o) &&
            !heldBySession(o, now),
        )
        .sort((a, b) => a.o.createdAt - b.o.createdAt || a.rowid - b.rowid)
        .map((c) => {
          const turn = (turns.get(c.o.userId) ?? 0) + 1;
          turns.set(c.o.userId, turn);
          return { ...c, turn };
        })
        .sort((a, b) => a.turn - b.turn || a.o.createdAt - b.o.createdAt || a.rowid - b.rowid)
        .slice(0, limit);
      return candidates.map(({ o }) => {
        o.deleting = true;
        o.verified = false;
        return { userId: o.userId, kind: o.kind, sha256: o.sha256 };
      });
    },
    async deleteObjectRows(keys) {
      let n = 0;
      for (const k of keys) {
        const id = objectId(k);
        if (state.objects.get(id)?.deleting) {
          state.objects.delete(id);
          n++;
        }
      }
      return n;
    },
    async sitesDueForCleanup(now, deferredBefore, limit) {
      const since = (s: SiteRow) => s.cleanupSince ?? s.cleanupAfter ?? 0;
      return [...state.sites.values()]
        .filter(
          (s) =>
            (s.cleanupAfter !== null && s.cleanupAfter < now) ||
            (s.cleanupSince !== null && s.cleanupSince < deferredBefore),
        )
        .sort((a, b) => since(a) - since(b) || (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map(ref);
    },
    async claimSiteLockForGc(siteId, lock, now, expiresAt) {
      const site = state.sites.get(siteId);
      if (!site || !lockFree(site, now)) return false;
      site.completeLock = lock;
      site.completeLockExpiresAt = expiresAt;
      return true;
    },
    async heldSessionPlans(siteId, now) {
      return [...state.sessions.values()]
        .filter((s) => s.siteId === siteId && s.holdUntil > now)
        .map((s) => ({
          plan: s.status === "completed" ? null : s.plan,
          holdUntil: s.holdUntil,
        }));
    },
    async uncommittedPlansMentioning(siteId, sha256) {
      return [...state.sessions.values()]
        .filter((s) => s.siteId === siteId && s.status !== "completed" && s.plan.includes(sha256))
        .map((s) => s.plan);
    },
    async finishSiteCleanup(siteId, lock, seen, next, now) {
      const site = state.sites.get(siteId);
      if (!site) return;
      if (site.completeLock === lock) {
        site.completeLock = null;
        site.completeLockExpiresAt = null;
      }
      if (site.cleanupAfter === seen) site.cleanupAfter = next;
      site.cleanupSince = site.cleanupAfter === null ? null : now;
    },
    async retireSessions(now, limit) {
      const due = [...state.sessions.values()]
        .filter((s) => s.holdUntil > 0 && s.holdUntil < now)
        .slice(0, Math.min(limit, 97));
      const ids = new Set(due.map((s) => s.id));
      state.sessionObjects = state.sessionObjects.filter((o) => !ids.has(o.sessionId));
      for (const s of due) {
        s.holdUntil = 0;
        if (s.status === "completed" || !starred(s.siteId)) s.plan = PLAN_STUB;
      }
      return due.length;
    },
    async deleteOldSessions({ now, completedBefore, uncommittedBefore, limit }) {
      const old = [...state.sessions.values()]
        .filter(
          (s) =>
            s.holdUntil < now &&
            (s.status === "completed"
              ? s.createdAt < completedBefore
              : s.expiresAt < uncommittedBefore && !starred(s.siteId)),
        )
        .slice(0, limit);
      const ids = new Set(old.map((s) => s.id));
      return deleteSessions((s) => ids.has(s.id));
    },
    async abandonedSites(now, createdBefore, limit) {
      if (limit <= 0) return [];
      return [...state.sites.values()]
        .filter(
          (s) =>
            s.headVersion === 0 &&
            s.createdAt < createdBefore &&
            ![...state.sessions.values()].some((x) => x.siteId === s.id && x.holdUntil > now),
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit)
        .map(ref);
    },
    async deleteAbandonedSite(siteId, lock, now) {
      const site = state.sites.get(siteId);
      if (
        !site ||
        site.headVersion !== 0 ||
        site.completeLock !== lock ||
        [...state.sessions.values()].some((x) => x.siteId === siteId && x.holdUntil > now)
      ) {
        return false;
      }
      state.sites.delete(siteId);
      deleteSessions((s) => s.siteId === siteId);
      deleteVersions((v) => v.siteId !== siteId);
      return true;
    },
  };
  return store;
};

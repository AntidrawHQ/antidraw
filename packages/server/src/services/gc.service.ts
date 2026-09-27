import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import {
  GC_ABANDONED_SITE_AGE_MS,
  GC_LOCK_TTL_MS,
  GC_MIN_AGE_MS,
  GC_OBJECTS_PER_RUN,
  GC_SESSION_RETENTION_MS,
  GC_SITES_PER_RUN,
  KEEP_VERSIONS,
  R2_DELETE_BATCH,
  SITE_CLEANUP_DELAY_MS,
} from "../lib/publish-limits";
import { blobKey, r2ObjectStore, sourceKey, type ObjectStore } from "../lib/storage";
import { parsePlan, randomId } from "./publish.service";
import {
  d1PublishStore,
  type PublishStore,
  type SiteRow,
  type UserObjectRef,
} from "./publish.store";

// Nightly GC (cron "17 3 * * *", src/scheduled.ts). Six independent steps,
// each bounded so one run fits the Workers Paid limits, each logging its
// counts; a failing step does not stop the next.
//
//   1. expire lapsed pending sessions
//   2. drop versions beyond the newest KEEP_VERSIONS (keep=1 excepted)
//   3. delete unreferenced, unheld account objects: claimed `deleting` in the
//      same statement that checks they are unreferenced, deleted from R2, and
//      only then their rows
//   4. delete stale site keys (not live, not protected, not in a held
//      session's plan) of sites whose cleanup_after has passed
//   5. forget old finished sessions
//   6. delete sites that never completed a publish, freeing their slugs

export type GcDeps = {
  store: PublishStore;
  sites: ObjectStore;
  sources: ObjectStore;
  runId: () => string;
};

export type GcReport = {
  expiredSessions: number;
  prunedVersions: number;
  deletedObjects: number;
  failedObjectBatches: number;
  cleanedSites: number;
  skippedSites: number;
  deletedSiteKeys: number;
  deletedSessions: number;
  deletedAbandonedSites: number;
  errors: string[];
};

export const makeGcDeps = (env: Bindings): GcDeps => ({
  store: d1PublishStore(getDb(env)),
  sites: r2ObjectStore(env.SITES),
  sources: r2ObjectStore(env.SOURCES),
  runId: () => randomId("gc", 12),
});

const objectKey = (o: UserObjectRef) =>
  o.kind === "source" ? sourceKey(o.userId, o.sha256) : blobKey(o.userId, o.sha256);

const inBatches = <T>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// Step 3. A row is deleted only after its own key is gone; a batch R2 refuses
// twice keeps its rows `deleting` for the next run (never `verified`, so no
// commit can lean on them meanwhile).
const collectObjects = async (deps: GcDeps, now: number, report: GcReport) => {
  const leftovers = await deps.store.leftoverDeletingObjects(GC_OBJECTS_PER_RUN);
  const claimed = await deps.store.claimGcObjects({
    now,
    minCreatedAt: now - GC_MIN_AGE_MS,
    limit: GC_OBJECTS_PER_RUN - leftovers.length,
  });
  for (const batch of inBatches([...leftovers, ...claimed], R2_DELETE_BATCH)) {
    const keys = batch.map(objectKey);
    let deleted = false;
    for (let attempt = 0; attempt < 2 && !deleted; attempt++) {
      try {
        await deps.sources.delete(keys);
        deleted = true;
      } catch (error) {
        console.error("gc: R2 delete failed", error);
      }
    }
    if (!deleted) {
      report.failedObjectBatches++;
      continue;
    }
    report.deletedObjects += await deps.store.deleteObjectRows(batch);
  }
};

const parsePaths = (json: string | null): string[] => {
  if (!json || json === "*") return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

// Deletes every key under <slug>/ that `keep` lacks (all of them without a
// keep set), re-checking before each batch that the GC lock is still ours:
// once it lapses a complete may own the site.
const deleteSiteKeys = async (
  deps: GcDeps,
  site: SiteRow,
  lock: string,
  keep: Set<string> | null,
  now: () => number,
) => {
  const prefix = `${site.slug}/`;
  const stale: string[] = [];
  for await (const info of deps.sites.list(prefix)) {
    if (!keep || !keep.has(info.key.slice(prefix.length))) stale.push(info.key);
  }
  let deleted = 0;
  for (const batch of inBatches(stale, R2_DELETE_BATCH)) {
    if (!(await deps.store.checkCompleteLock(site.id, lock, now(), 0))) {
      return { deleted, complete: false };
    }
    await deps.sites.delete(batch);
    deleted += batch.length;
  }
  return { deleted, complete: true };
};

// Every path the site may still serve: the head's files, what an
// uncommitted complete protected, and the plan of every session still able to
// upload. Null when that cannot be known ("*", or an unreadable plan).
const keepSet = (site: SiteRow, held: { plan: string }[]): Set<string> | null => {
  if (site.protectedFiles === "*") return null;
  const keep = new Set([...parsePaths(site.liveFiles), ...parsePaths(site.protectedFiles)]);
  for (const { plan: raw } of held) {
    const plan = parsePlan(raw);
    if (!plan) return null;
    for (const f of plan.site.files) keep.add(f.path);
    for (const e of plan.site.entries) keep.add(e.path);
  }
  return keep;
};

// Step 4, one site.
const cleanSite = async (
  deps: GcDeps,
  due: SiteRow,
  lock: string,
  clock: () => number,
  report: GcReport,
) => {
  const now = clock();
  if (!(await deps.store.claimSiteLockForGc(due.id, lock, now, now + GC_LOCK_TTL_MS))) {
    report.skippedSites++;
    return;
  }
  try {
    const site = await deps.store.findSiteById(due.id);
    if (!site) return;
    const seen = site.cleanupAfter;
    const held = await deps.store.heldSessionPlans(site.id, now);
    const lastHold = held.reduce((max, s) => Math.max(max, s.holdUntil), 0);
    let next: number | null = lastHold > 0 ? lastHold + SITE_CLEANUP_DELAY_MS : null;

    const keep = keepSet(site, held);
    if (keep) {
      const { deleted } = await deleteSiteKeys(deps, site, lock, keep, clock);
      report.deletedSiteKeys += deleted;
    } else {
      // Nothing is deleted until a commit, or a complete whose entries all
      // went live, makes the paths knowable again; come back tomorrow rather
      // than head every night's batch.
      next = Math.max(next ?? 0, now + GC_MIN_AGE_MS);
    }
    report.cleanedSites++;
    await deps.store.finishSiteCleanup(site.id, lock, seen, next);
  } finally {
    // finishSiteCleanup releases too; this covers the early exits.
    await deps.store.releaseCompleteLock(due.id, lock);
  }
};

// Step 6, one site: its keys first, then the row (which frees the slug).
const deleteAbandonedSite = async (
  deps: GcDeps,
  site: SiteRow,
  lock: string,
  clock: () => number,
  report: GcReport,
) => {
  const now = clock();
  if (!(await deps.store.claimSiteLockForGc(site.id, lock, now, now + GC_LOCK_TTL_MS))) {
    report.skippedSites++;
    return;
  }
  try {
    const { deleted, complete } = await deleteSiteKeys(deps, site, lock, null, clock);
    report.deletedSiteKeys += deleted;
    if (complete && (await deps.store.deleteAbandonedSite(site.id, lock, clock()))) {
      report.deletedAbandonedSites++;
    }
  } finally {
    await deps.store.releaseCompleteLock(site.id, lock);
  }
};

export const runGc = async (deps: GcDeps, when: Date): Promise<GcReport> => {
  const now = when.getTime();
  // `when`, advanced by the real time this run has taken: lock checks must
  // see a lock lapse even though the run's notion of "now" is fixed.
  const started = performance.now();
  const clock = () => now + Math.floor(performance.now() - started);
  const lock = `gc:${deps.runId()}`;
  const report: GcReport = {
    expiredSessions: 0,
    prunedVersions: 0,
    deletedObjects: 0,
    failedObjectBatches: 0,
    cleanedSites: 0,
    skippedSites: 0,
    deletedSiteKeys: 0,
    deletedSessions: 0,
    deletedAbandonedSites: 0,
    errors: [],
  };
  let sitesVisited = 0;

  const step = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      console.error(`gc: ${name} failed`, error);
      report.errors.push(name);
    }
  };

  await step("expire-sessions", async () => {
    report.expiredSessions = await deps.store.expireSessions(now);
  });
  await step("prune-versions", async () => {
    report.prunedVersions = await deps.store.pruneVersions(KEEP_VERSIONS);
  });
  await step("objects", () => collectObjects(deps, now, report));
  await step("site-cleanup", async () => {
    const due = await deps.store.sitesDueForCleanup(now, GC_SITES_PER_RUN);
    for (const site of due) {
      sitesVisited++;
      await step(`site-cleanup:${site.id}`, () => cleanSite(deps, site, lock, clock, report));
    }
  });
  await step("old-sessions", async () => {
    report.deletedSessions = await deps.store.deleteOldSessions(now, now - GC_SESSION_RETENTION_MS);
  });
  await step("abandoned-sites", async () => {
    const abandoned = await deps.store.abandonedSites(
      now,
      now - GC_ABANDONED_SITE_AGE_MS,
      GC_SITES_PER_RUN - sitesVisited,
    );
    for (const site of abandoned) {
      await step(`abandoned-site:${site.id}`, () =>
        deleteAbandonedSite(deps, site, lock, clock, report),
      );
    }
  });
  return report;
};

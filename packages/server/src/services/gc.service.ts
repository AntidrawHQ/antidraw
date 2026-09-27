import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { ENTRY_PATHS } from "../lib/paths";
import {
  GC_ABANDONED_SITE_AGE_MS,
  GC_ABANDONED_SITES_PER_RUN,
  GC_CLOCK_SKEW_MARGIN_MS,
  GC_LOCK_TTL_MS,
  GC_MAX_CLEANUP_DEFER_MS,
  GC_MIN_AGE_MS,
  GC_OBJECTS_PER_RUN,
  GC_RUN_BUDGET_MS,
  GC_SESSION_RETENTION_MS,
  GC_SESSION_STATEMENTS_PER_RUN,
  GC_SESSIONS_PER_STATEMENT,
  GC_SITE_CLEANUP_CRON,
  GC_SITE_KEYS_PER_RUN,
  GC_SITE_KEYS_PER_VISIT,
  GC_SITE_RUN_BUDGET_MS,
  GC_SITES_PER_RUN,
  GC_UNCOMMITTED_SESSION_RETENTION_MS,
  GC_UNRESOLVED_ENTRY_MAX_AGE_MS,
  KEEP_VERSIONS,
  R2_DELETE_BATCH,
  SITE_CLEANUP_DELAY_MS,
} from "../lib/publish-limits";
import { blobKey, r2ObjectStore, siteKey, sourceKey, type ObjectStore } from "../lib/storage";
import { parsePlan, planSitePaths, randomId, unionProtected } from "./publish.service";
import {
  d1PublishStore,
  PLAN_STUB,
  type PublishStore,
  type SiteRef,
  type SiteRow,
  type UserObjectRef,
} from "./publish.store";

// GC (src/scheduled.ts): a "full" run hourly (GC_CRON) takes six
// independent steps; a "sites" run every five minutes (GC_SITE_CLEANUP_CRON)
// takes step 4 alone, so site cleanup gets more than one run's budget an hour
// (publish-limits.ts has the numbers). Each step is bounded (the GcLimits
// below, and a wall-clock budget for the run) so one run fits the Workers
// Paid limits, each logging its counts; a failing step does not stop the
// next. A step that stops with work left names itself in `report.backlog`,
// and the next run continues.
//
//   1. expire lapsed pending sessions
//   2. drop versions beyond the newest KEEP_VERSIONS (keep=1 excepted)
//   3. delete unreferenced, unheld account objects: claimed `deleting` in the
//      same statement that checks they are unreferenced (taking turns across
//      accounts), deleted from R2, and only then their rows
//   4. delete stale site keys (not live, not protected, not in an
//      uncommitted held session's plan) of sites whose cleanup_after has
//      passed or whose cleanup has been put off for too long
//   5. retire sessions whose hold ended, and forget old ones
//   6. delete sites that never completed a publish, freeing their slugs
//
// Every step that asks whether a session has expired or still holds asks it
// of `holdCutoff`, GC's clock less GC_CLOCK_SKEW_MARGIN_MS: a complete judges
// the same session by its own Worker's clock, which may lag GC's.

export type GcLimits = {
  runBudgetMs: number;
  objectsPerRun: number;
  deleteBatch: number;
  sitesPerRun: number;
  abandonedSitesPerRun: number;
  siteKeysPerVisit: number;
  siteKeysPerRun: number;
  sessionsPerStatement: number;
  sessionStatementsPerRun: number;
};

export const GC_LIMITS: GcLimits = {
  runBudgetMs: GC_RUN_BUDGET_MS,
  objectsPerRun: GC_OBJECTS_PER_RUN,
  deleteBatch: R2_DELETE_BATCH,
  sitesPerRun: GC_SITES_PER_RUN,
  abandonedSitesPerRun: GC_ABANDONED_SITES_PER_RUN,
  siteKeysPerVisit: GC_SITE_KEYS_PER_VISIT,
  siteKeysPerRun: GC_SITE_KEYS_PER_RUN,
  sessionsPerStatement: GC_SESSIONS_PER_STATEMENT,
  sessionStatementsPerRun: GC_SESSION_STATEMENTS_PER_RUN,
};

// Which steps a run takes.
export type GcMode = "full" | "sites";

// Anything but the site-cleanup cron is the hourly run (GC_CRON), so a
// changed or manually triggered cron still gets the full GC.
export const gcModeFor = (cron: string): GcMode =>
  cron === GC_SITE_CLEANUP_CRON ? "sites" : "full";

export type GcDeps = {
  store: PublishStore;
  sites: ObjectStore;
  sources: ObjectStore;
  runId: () => string;
  // Tests shrink these.
  limits?: Partial<GcLimits>;
};

export type GcReport = {
  expiredSessions: number;
  prunedVersions: number;
  deletedObjects: number;
  failedObjectBatches: number;
  cleanedSites: number;
  skippedSites: number;
  deletedSiteKeys: number;
  retiredSessions: number;
  deletedSessions: number;
  deletedAbandonedSites: number;
  // Steps that stopped at a limit with work left.
  backlog: string[];
  errors: string[];
};

export const makeGcDeps = (env: Bindings): GcDeps => ({
  store: d1PublishStore(getDb(env)),
  sites: r2ObjectStore(env.SITES),
  sources: r2ObjectStore(env.SOURCES),
  runId: () => randomId("gc", 12),
});

type Run = {
  deps: GcDeps;
  limits: GcLimits;
  now: number;
  // `now`, advanced by the real time this run has taken: lock checks must
  // see a lock lapse even though the run's notion of "now" is fixed.
  clock: () => number;
  outOfTime: () => boolean;
  lock: string;
  report: GcReport;
  siteKeysLeft: number;
};

// A session holds while its hold_until is past this: GC acts on a hold only
// once it ended GC_CLOCK_SKEW_MARGIN_MS ago by GC's clock.
const holdCutoff = (at: number) => at - GC_CLOCK_SKEW_MARGIN_MS;

const behind = (run: Run, step: string) => {
  if (!run.report.backlog.includes(step)) run.report.backlog.push(step);
};

const objectKey = (o: UserObjectRef) =>
  o.kind === "source" ? sourceKey(o.userId, o.sha256) : blobKey(o.userId, o.sha256);

const inBatches = <T>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// Step 3. A row is deleted only after its own key is gone. A batch R2 refuses
// twice keeps its rows `deleting` (never `verified`, so no commit can lean on
// them meanwhile), and so does every batch the run did not reach: the next
// run takes them first, as leftovers.
const collectObjects = async (run: Run) => {
  const { deps, limits, now, report } = run;
  const leftovers = await deps.store.leftoverDeletingObjects(limits.objectsPerRun);
  const claimed = await deps.store.claimGcObjects({
    now: holdCutoff(now),
    minCreatedAt: now - GC_MIN_AGE_MS,
    limit: limits.objectsPerRun - leftovers.length,
  });
  const todo = [...leftovers, ...claimed];
  if (todo.length >= limits.objectsPerRun) behind(run, "objects");
  for (const batch of inBatches(todo, limits.deleteBatch)) {
    if (run.outOfTime()) {
      behind(run, "objects");
      return;
    }
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
      // R2 is refusing; the rest waits for the next run.
      report.failedObjectBatches++;
      behind(run, "objects");
      return;
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

const parseEntries = (json: string | null): { path: string; sha256: string }[] => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((e: { path?: unknown; sha256?: unknown }) => ({
          path: String(e.path),
          sha256: String(e.sha256),
        }))
      : [];
  } catch {
    return [];
  }
};

// Deletes every key under <slug>/ that `keep` lacks (all of them without a
// keep set) as it lists, one R2 batch at a time, so memory stays one batch
// whatever the prefix holds. Before each delete it re-checks that the GC lock
// is still ours: once it lapses a complete may own the site. Stops early at
// the per-visit or per-run key limit; `complete` says whether it saw every key.
const deleteSiteKeys = async (run: Run, site: SiteRef, keep: Set<string> | null) => {
  const { deps, limits, lock } = run;
  const prefix = `${site.slug}/`;
  let listed = 0;
  let deleted = 0;
  let stale: string[] = [];
  const flush = async () => {
    if (stale.length === 0) return true;
    if (!(await deps.store.checkCompleteLock(site.id, lock, run.clock(), 0))) return false;
    await deps.sites.delete(stale);
    deleted += stale.length;
    stale = [];
    return true;
  };
  for await (const info of deps.sites.list(prefix)) {
    if (listed >= limits.siteKeysPerVisit || run.siteKeysLeft <= 0) {
      await flush();
      return { deleted, complete: false };
    }
    listed++;
    run.siteKeysLeft--;
    if (!keep || !keep.has(info.key.slice(prefix.length))) stale.push(info.key);
    if (stale.length >= limits.deleteBatch && !(await flush())) {
      return { deleted, complete: false };
    }
  }
  const complete = await flush();
  return { deleted, complete };
};

// The paths a protected "*" stands for, worked out from the entry files that
// are actually live: one that is the head's refers only to live_files; any
// other was written by a complete that did not commit, whose session plan
// names what it refers to. Null when an entry matches neither and is recent:
// then its references are unknowable, and nothing may be deleted yet.
const resolveStar = async (run: Run, site: SiteRow): Promise<string[] | null> => {
  const { deps, now } = run;
  const head = parseEntries(site.liveEntries);
  const paths = new Set<string>();
  for (const path of ENTRY_PATHS) {
    const live = await deps.sites.head(siteKey(site.slug, path));
    if (!live?.sha256) continue;
    const sha256 = live.sha256;
    if (head.some((e) => e.path === path && e.sha256 === sha256)) continue;
    const plans = (await deps.store.uncommittedPlansMentioning(site.id, sha256))
      .map(parsePlan)
      .filter((p) => p?.site.entries.some((e) => e.path === path && e.sha256 === sha256));
    if (plans.length > 0) {
      for (const plan of plans) for (const p of planSitePaths(plan!)) paths.add(p);
    } else if (live.uploaded.getTime() >= now - GC_UNRESOLVED_ENTRY_MAX_AGE_MS) {
      return null;
    }
  }
  return [...paths];
};

// Every path the site may still serve: the head's files, what an
// uncommitted complete protected, and the plan of every uncommitted session
// still able to upload. Null when a plan cannot be read.
const keepSet = (
  liveFiles: string | null,
  protectedPaths: string[],
  held: { plan: string | null }[],
): Set<string> | null => {
  const keep = new Set([...parsePaths(liveFiles), ...protectedPaths]);
  for (const { plan: raw } of held) {
    if (raw === null) continue; // committed: its paths went live with it
    // Stubbed while it still holds (within GC's margin): an abort that was
    // never given a URL, so it has no paths to keep.
    if (raw === PLAN_STUB) continue;
    const plan = parsePlan(raw);
    if (!plan) return null;
    for (const p of planSitePaths(plan)) keep.add(p);
  }
  return keep;
};

// Step 4, one site.
const cleanSite = async (run: Run, due: SiteRef) => {
  const { deps, lock, report } = run;
  const now = run.clock();
  if (!(await deps.store.claimSiteLockForGc(due.id, lock, now, now + GC_LOCK_TTL_MS))) {
    report.skippedSites++;
    return;
  }
  try {
    const site = await deps.store.findSiteById(due.id);
    if (!site) return;
    const seen = site.cleanupAfter;
    const held = await deps.store.heldSessionPlans(site.id, holdCutoff(now));
    const lastHold = held.reduce((max, s) => Math.max(max, s.holdUntil), 0);
    let next: number | null = lastHold > 0 ? lastHold + SITE_CLEANUP_DELAY_MS : null;

    let protectedPaths: string[] | null = parsePaths(site.protectedFiles);
    if (site.protectedFiles === "*") {
      protectedPaths = await resolveStar(run, site);
      if (protectedPaths) {
        // Store what "*" stood for, so later visits (and session retirement)
        // no longer need the plans. Still "*" when it does not fit the row;
        // this visit uses the paths either way.
        const resolved =
          protectedPaths.length === 0 ? null : unionProtected(null, protectedPaths, site.liveFiles);
        if (resolved !== "*") {
          await deps.store.setProtectedFiles({
            siteId: site.id,
            lock,
            protectedFiles: resolved,
            seenProtected: "*",
          });
        }
      }
    }
    const keep = protectedPaths ? keepSet(site.liveFiles, protectedPaths, held) : null;
    if (keep) {
      const { deleted, complete } = await deleteSiteKeys(run, site, keep);
      report.deletedSiteKeys += deleted;
      if (!complete) {
        // Leave cleanup_after due: the next run lists the site again.
        behind(run, "site-cleanup");
        return;
      }
    } else {
      // Nothing is deleted until a commit, or a complete whose entries all
      // went live, makes the paths knowable again; come back tomorrow rather
      // than head every run's batch.
      next = Math.max(next ?? 0, now + GC_MIN_AGE_MS);
    }
    report.cleanedSites++;
    await deps.store.finishSiteCleanup(site.id, lock, seen, next, now);
  } finally {
    // finishSiteCleanup releases too; this covers the early exits.
    await deps.store.releaseCompleteLock(due.id, lock);
  }
};

// Step 6, one site: its keys first, then the row (which frees the slug).
const deleteAbandonedSite = async (run: Run, site: SiteRef) => {
  const { deps, lock, report } = run;
  const now = run.clock();
  if (!(await deps.store.claimSiteLockForGc(site.id, lock, now, now + GC_LOCK_TTL_MS))) {
    report.skippedSites++;
    return;
  }
  try {
    const { deleted, complete } = await deleteSiteKeys(run, site, null);
    report.deletedSiteKeys += deleted;
    if (!complete) {
      behind(run, "abandoned-sites");
      return;
    }
    if (await deps.store.deleteAbandonedSite(site.id, lock, holdCutoff(run.clock()))) {
      report.deletedAbandonedSites++;
    }
  } finally {
    await deps.store.releaseCompleteLock(site.id, lock);
  }
};

// Step 5.
const sweepSessions = async (run: Run) => {
  const { deps, limits, now, report } = run;
  const repeat = async (name: string, once: () => Promise<number>) => {
    let total = 0;
    for (let i = 0; i < limits.sessionStatementsPerRun; i++) {
      if (run.outOfTime()) {
        behind(run, name);
        return total;
      }
      const n = await once();
      total += n;
      if (n < limits.sessionsPerStatement) return total;
    }
    behind(run, name);
    return total;
  };
  report.retiredSessions = await repeat("retire-sessions", () =>
    deps.store.retireSessions(holdCutoff(now), limits.sessionsPerStatement),
  );
  report.deletedSessions = await repeat("old-sessions", () =>
    deps.store.deleteOldSessions({
      now: holdCutoff(now),
      completedBefore: now - GC_SESSION_RETENTION_MS,
      uncommittedBefore: now - GC_UNCOMMITTED_SESSION_RETENTION_MS,
      limit: limits.sessionsPerStatement,
    }),
  );
};

export const runGc = async (
  deps: GcDeps,
  when: Date,
  mode: GcMode = "full",
): Promise<GcReport> => {
  const now = when.getTime();
  const limits = {
    ...GC_LIMITS,
    ...(mode === "sites" ? { runBudgetMs: GC_SITE_RUN_BUDGET_MS } : {}),
    ...deps.limits,
  };
  const started = performance.now();
  const report: GcReport = {
    expiredSessions: 0,
    prunedVersions: 0,
    deletedObjects: 0,
    failedObjectBatches: 0,
    cleanedSites: 0,
    skippedSites: 0,
    deletedSiteKeys: 0,
    retiredSessions: 0,
    deletedSessions: 0,
    deletedAbandonedSites: 0,
    backlog: [],
    errors: [],
  };
  const run: Run = {
    deps,
    limits,
    now,
    clock: () => now + Math.floor(performance.now() - started),
    outOfTime: () => performance.now() - started > limits.runBudgetMs,
    lock: `gc:${deps.runId()}`,
    report,
    siteKeysLeft: limits.siteKeysPerRun,
  };

  const step = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      console.error(`gc: ${name} failed`, error);
      report.errors.push(name);
    }
  };
  // One site at a time, until the run's time or site keys run out.
  const eachSite = async (
    name: string,
    sites: SiteRef[],
    visit: (site: SiteRef) => Promise<void>,
  ) => {
    for (const site of sites) {
      if (run.outOfTime() || run.siteKeysLeft <= 0) {
        behind(run, name);
        return;
      }
      await step(`${name}:${site.id}`, () => visit(site));
    }
  };

  const cleanSites = () =>
    step("site-cleanup", async () => {
      const due = await deps.store.sitesDueForCleanup(
        now,
        now - GC_MAX_CLEANUP_DEFER_MS,
        limits.sitesPerRun,
      );
      if (due.length >= limits.sitesPerRun) behind(run, "site-cleanup");
      await eachSite("site-cleanup", due, (site) => cleanSite(run, site));
    });
  if (mode === "sites") {
    await cleanSites();
    if (report.backlog.length > 0) {
      console.warn("gc: sites left for the next run", report.backlog);
    }
    return report;
  }

  await step("expire-sessions", async () => {
    // A session's expiry is its hold's end until something ends the hold
    // sooner; expiring it fails a commit its (lagging) complete would pass.
    report.expiredSessions = await deps.store.expireSessions(holdCutoff(now));
  });
  await step("prune-versions", async () => {
    report.prunedVersions = await deps.store.pruneVersions(KEEP_VERSIONS);
  });
  await step("objects", () => collectObjects(run));
  await cleanSites();
  await step("sessions", () => sweepSessions(run));
  await step("abandoned-sites", async () => {
    const abandoned = await deps.store.abandonedSites(
      holdCutoff(now),
      now - GC_ABANDONED_SITE_AGE_MS,
      limits.abandonedSitesPerRun,
    );
    if (abandoned.length >= limits.abandonedSitesPerRun) behind(run, "abandoned-sites");
    await eachSite("abandoned-sites", abandoned, (site) => deleteAbandonedSite(run, site));
  });

  if (report.backlog.length > 0) {
    console.warn("gc: work left for the next run", report.backlog);
  }
  return report;
};

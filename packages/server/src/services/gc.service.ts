import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import {
  GC_ABANDONED_SITE_AGE_MS,
  GC_ABANDONED_SITES_PER_RUN,
  GC_CLOCK_SKEW_MARGIN_MS,
  GC_LOCK_TTL_MS,
  GC_MIN_AGE_MS,
  GC_OBJECTS_PER_CLAIM,
  GC_OBJECTS_PER_RUN,
  GC_POINTER_SYNCS_PER_RUN,
  GC_RUN_BUDGET_MS,
  GC_SESSION_OBJECTS_PER_STATEMENT,
  GC_SESSION_RETENTION_MS,
  GC_SESSION_STATEMENTS_PER_RUN,
  GC_SESSIONS_PER_STATEMENT,
  GC_UNCOMMITTED_SESSION_RETENTION_MS,
  GC_VERSION_STATEMENTS_PER_RUN,
  GC_VERSIONS_PER_STATEMENT,
  KEEP_VERSIONS,
  R2_DELETE_BATCH,
} from "../lib/publish-limits";
import { pointerKey, r2ObjectStore, type ObjectStore } from "../lib/storage";
import { objectLocation, randomId } from "./publish.service";
import {
  d1PublishStore,
  type PublishStore,
  type SiteRef,
  type UserObjectRef,
} from "./publish.store";
import { syncPointer } from "./site-pointer";

// GC (src/scheduled.ts), hourly (GC_CRON). Six independent steps, each
// bounded (the GcLimits below, and a wall-clock budget for the run) so one
// run fits the Workers Paid limits, each logging its counts; a failing step
// does not stop the next. A step that stops with work left names itself in
// `report.backlog`, and the next run continues. Every statement a step runs
// acts on a bounded number of rows, cascades included.
//
//   1. expire lapsed pending sessions
//   2. drop versions beyond the newest KEEP_VERSIONS (keep=1 excepted)
//   3. re-sync the pointers of sites whose pointer is behind their head
//      version (a complete whose switch-over failed and was not retried)
//   4. delete unreferenced, unheld account objects (sources, blobs and site
//      contents): claimed `deleting` in the same statement that checks they
//      are unreferenced (taking turns across accounts), deleted from R2, and
//      only then their rows
//   5. retire sessions whose hold ended, and forget old ones
//   6. delete sites that never completed a publish and have no session left
//      (their pointer, then the row), freeing their slugs
//
// A site's files are ordinary objects: what no retained version lists is
// collected by step 4 like any other. Every step that asks whether a session
// has expired or still holds asks it of `holdCutoff`, GC's clock less
// GC_CLOCK_SKEW_MARGIN_MS: a complete judges the same session by its own
// Worker's clock, which may lag GC's.

export type GcLimits = {
  runBudgetMs: number;
  objectsPerRun: number;
  objectsPerClaim: number;
  deleteBatch: number;
  pointerSyncsPerRun: number;
  abandonedSitesPerRun: number;
  sessionsPerStatement: number;
  sessionObjectsPerStatement: number;
  sessionStatementsPerRun: number;
  versionsPerStatement: number;
  versionStatementsPerRun: number;
};

export const GC_LIMITS: GcLimits = {
  runBudgetMs: GC_RUN_BUDGET_MS,
  objectsPerRun: GC_OBJECTS_PER_RUN,
  objectsPerClaim: GC_OBJECTS_PER_CLAIM,
  deleteBatch: R2_DELETE_BATCH,
  pointerSyncsPerRun: GC_POINTER_SYNCS_PER_RUN,
  abandonedSitesPerRun: GC_ABANDONED_SITES_PER_RUN,
  sessionsPerStatement: GC_SESSIONS_PER_STATEMENT,
  sessionObjectsPerStatement: GC_SESSION_OBJECTS_PER_STATEMENT,
  sessionStatementsPerRun: GC_SESSION_STATEMENTS_PER_RUN,
  versionsPerStatement: GC_VERSIONS_PER_STATEMENT,
  versionStatementsPerRun: GC_VERSION_STATEMENTS_PER_RUN,
};

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
  syncedPointers: number;
  deletedObjects: number;
  failedObjectBatches: number;
  retiredSessions: number;
  deletedSessions: number;
  deletedAbandonedSites: number;
  skippedSites: number;
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
};

// A session holds while its hold_until is past this: GC acts on a hold only
// once it ended GC_CLOCK_SKEW_MARGIN_MS ago by GC's clock.
const holdCutoff = (at: number) => at - GC_CLOCK_SKEW_MARGIN_MS;

const behind = (run: Run, step: string) => {
  if (!run.report.backlog.includes(step)) run.report.backlog.push(step);
};

// Runs a bounded statement (`once`, returning whether it may have left work)
// up to `times` times, while the run has time. Names `step` as behind when
// work is left.
const repeat = async (run: Run, step: string, times: number, once: () => Promise<boolean>) => {
  for (let i = 0; i < times; i++) {
    if (run.outOfTime()) {
      behind(run, step);
      return;
    }
    if (!(await once())) return;
  }
  behind(run, step);
};

const inBatches = <T>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// Deletes `keys` from `store`, trying twice. False when R2 refused both times.
const deleteKeys = async (store: ObjectStore, keys: string[]) => {
  if (keys.length === 0) return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.delete(keys);
      return true;
    } catch (error) {
      console.error("gc: R2 delete failed", error);
    }
  }
  return false;
};

// Step 4, in claims of at most objectsPerClaim up to objectsPerRun. A row is
// deleted only after its own key is gone. A batch R2 refuses twice keeps its
// rows `deleting` (never `verified`, so no commit can lean on them
// meanwhile), and so does every batch the run did not reach: the next claim
// or run takes them first, as leftovers.
//
// Invariant: this is the only code that deletes an account object's key, and
// it deletes only keys whose rows claimGcObjects already marked deleting (and
// unverified), never one a live session held at the claim. So a row that is
// verified and not deleting always has its bytes in R2, and a held object a
// complete found stays there: begin skips uploads and complete skips HEADs on
// that alone (publish.service.ts, findMissing). Anything new that deletes
// object keys must mark their rows the same way first.
//
// And no row goes while a PUT could still write its key: a session holds its
// objects until UPLOAD_PUT_GRACE_MS after its URLs expire, and a row a
// session came to hold after the claim (a begin signs URLs for deleting
// rows) is kept by deleteObjectRows, unverified, rather than deleted. Bytes
// in R2 without a row would count toward nothing and never be collected.
const collectObjects = async (run: Run) => {
  let taken = 0;
  while (taken < run.limits.objectsPerRun) {
    if (taken > 0 && run.outOfTime()) break;
    const want = Math.min(run.limits.objectsPerClaim, run.limits.objectsPerRun - taken);
    const outcome = await collectObjectClaim(run, want);
    if (outcome === "stopped") return;
    taken += outcome;
    if (outcome < want) return; // nothing left to claim
  }
  behind(run, "objects");
};

// One claim of up to `limit` objects: how many it took, or "stopped" when R2
// refused or the run ran out of time (either marks the step behind).
const collectObjectClaim = async (run: Run, limit: number): Promise<number | "stopped"> => {
  const { deps, limits, now, report } = run;
  const leftovers = await deps.store.leftoverDeletingObjects(limit);
  const claimed = await deps.store.claimGcObjects({
    now: holdCutoff(now),
    minCreatedAt: now - GC_MIN_AGE_MS,
    limit: limit - leftovers.length,
  });
  const todo = [...leftovers, ...claimed];
  for (const batch of inBatches(todo, limits.deleteBatch)) {
    if (run.outOfTime()) {
      behind(run, "objects");
      return "stopped";
    }
    const keys = { sites: [] as string[], sources: [] as string[] };
    for (const o of batch) {
      const { bucket, key } = objectLocation(o.userId, o);
      keys[bucket].push(key);
    }
    const deleted =
      (await deleteKeys(deps.sources, keys.sources)) && (await deleteKeys(deps.sites, keys.sites));
    if (!deleted) {
      // R2 is refusing; the rest waits for the next run.
      report.failedObjectBatches++;
      behind(run, "objects");
      return "stopped";
    }
    report.deletedObjects += await deps.store.deleteObjectRows(batch, holdCutoff(now));
  }
  return todo.length;
};

// Step 3. Conditional pointer writes make this safe beside a complete that is
// writing the same pointer: the older version never wins.
const syncPointers = async (run: Run) => {
  const { deps, limits, report } = run;
  const sites = await deps.store.sitesBehindPointer(limits.pointerSyncsPerRun);
  if (sites.length >= limits.pointerSyncsPerRun) behind(run, "pointers");
  for (const site of sites) {
    if (run.outOfTime()) {
      behind(run, "pointers");
      return;
    }
    try {
      const outcome = await syncPointer(deps, site);
      if (outcome === "written" || outcome === "current") report.syncedPointers++;
      else behind(run, "pointers");
    } catch (error) {
      console.error(`gc: pointer sync of ${site.id} failed`, error);
      report.errors.push(`pointers:${site.id}`);
    }
  }
};

// Step 6, one site: its pointer first (a site that never completed has none,
// but nothing must serve a slug once it is free), then the row.
const deleteAbandonedSite = async (run: Run, site: SiteRef) => {
  const { deps, lock, report } = run;
  const now = run.clock();
  if (!(await deps.store.claimSiteLockForGc(site.id, lock, now, now + GC_LOCK_TTL_MS))) {
    report.skippedSites++;
    return;
  }
  try {
    await deps.sites.delete([pointerKey(site.slug)]);
    if (await deps.store.deleteAbandonedSite(site.id, lock)) {
      report.deletedAbandonedSites++;
    }
  } finally {
    await deps.store.releaseCompleteLock(site.id, lock);
  }
};

// Step 5. Retiring deletes session objects whole sessions at a time, and a
// session is retired once its last one is gone.
const sweepSessions = async (run: Run) => {
  const { deps, limits, now, report } = run;
  await repeat(run, "retire-sessions", limits.sessionStatementsPerRun, async () => {
    const done = await deps.store.retireSessions(
      holdCutoff(now),
      limits.sessionsPerStatement,
      limits.sessionObjectsPerStatement,
    );
    report.retiredSessions += done.sessions;
    return (
      done.sessions >= limits.sessionsPerStatement ||
      done.objects >= limits.sessionObjectsPerStatement
    );
  });
  await repeat(run, "old-sessions", limits.sessionStatementsPerRun, async () => {
    const n = await deps.store.deleteOldSessions({
      now: holdCutoff(now),
      completedBefore: now - GC_SESSION_RETENTION_MS,
      uncommittedBefore: now - GC_UNCOMMITTED_SESSION_RETENTION_MS,
      limit: limits.sessionsPerStatement,
    });
    report.deletedSessions += n;
    return n >= limits.sessionsPerStatement;
  });
};

export const runGc = async (deps: GcDeps, when: Date): Promise<GcReport> => {
  const now = when.getTime();
  const limits = { ...GC_LIMITS, ...deps.limits };
  const started = performance.now();
  const report: GcReport = {
    expiredSessions: 0,
    prunedVersions: 0,
    syncedPointers: 0,
    deletedObjects: 0,
    failedObjectBatches: 0,
    retiredSessions: 0,
    deletedSessions: 0,
    deletedAbandonedSites: 0,
    skippedSites: 0,
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
  };

  const step = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      console.error(`gc: ${name} failed`, error);
      report.errors.push(name);
    }
  };

  await step("expire-sessions", () =>
    // Expiring a session fails a commit its complete, judging the expiry by
    // its own (possibly lagging) clock, would pass: the margin applies here
    // too. Its hold outlasts the expiry (UPLOAD_PUT_GRACE_MS).
    repeat(run, "expire-sessions", limits.sessionStatementsPerRun, async () => {
      const n = await deps.store.expireSessions(holdCutoff(now), limits.sessionsPerStatement);
      report.expiredSessions += n;
      return n >= limits.sessionsPerStatement;
    }),
  );
  await step("prune-versions", () =>
    repeat(run, "prune-versions", limits.versionStatementsPerRun, async () => {
      const n = await deps.store.pruneVersions(KEEP_VERSIONS, limits.versionsPerStatement);
      report.prunedVersions += n;
      return n >= limits.versionsPerStatement;
    }),
  );
  // Before objects: a pointer that lags its head may still list contents of
  // a version pruned since, and re-syncing it first narrows that window.
  await step("pointers", () => syncPointers(run));
  await step("objects", () => collectObjects(run));
  await step("sessions", () => sweepSessions(run));
  await step("abandoned-sites", async () => {
    const abandoned = await deps.store.abandonedSites(
      now - GC_ABANDONED_SITE_AGE_MS,
      limits.abandonedSitesPerRun,
    );
    if (abandoned.length >= limits.abandonedSitesPerRun) behind(run, "abandoned-sites");
    for (const site of abandoned) {
      if (run.outOfTime()) {
        behind(run, "abandoned-sites");
        return;
      }
      await step(`abandoned-sites:${site.id}`, () => deleteAbandonedSite(run, site));
    }
  });

  if (report.backlog.length > 0) {
    console.warn("gc: work left for the next run", report.backlog);
  }
  return report;
};

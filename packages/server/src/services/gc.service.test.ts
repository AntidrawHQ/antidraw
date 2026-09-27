import { describe, expect, it } from "vitest";
import {
  GC_CLOCK_SKEW_MARGIN_MS,
  GC_CRON,
  GC_MAX_CLEANUP_DEFER_MS,
  GC_SITE_CLEANUP_CRON,
  GC_SITES_PER_RUN,
  MAX_SITE_STORED_BYTES,
  GC_UNRESOLVED_ENTRY_MAX_AGE_MS,
  SESSION_TTL_MS,
  SITE_CLEANUP_DELAY_MS,
} from "../lib/publish-limits";
import { blobKey, sourceKey } from "../lib/storage";
import {
  beginRequest,
  completeRequest,
  defaultEntries,
  harnesses,
  hex,
  makeTestDeps,
  MiB,
  performUploads,
  workspaceId,
  type PlanInput,
  type TestDeps,
} from "../test/publish-harness";
import { readFileSync } from "node:fs";
import { gcModeFor, runGc } from "./gc.service";
import { abortPublish, beginPublish, completePublish } from "./publish.service";
import { PLAN_STUB } from "./publish.store";

const USER = "user-1";
const OTHER = "user-2";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const begin = async (deps: TestDeps, input: PlanInput = {}) =>
  (await beginPublish(deps, USER, await beginRequest(input)))._unsafeUnwrap();

const publish = async (deps: TestDeps, input: PlanInput = {}) => {
  const begun = await begin(deps, input);
  performUploads(deps, begun.uploads);
  (
    await completePublish(deps, USER, begun.publish.id, completeRequest(input.entries))
  )._unsafeUnwrap();
  return begun;
};

const gcAt = (deps: TestDeps, at: number) => {
  deps.clock.now = at;
  return runGc(deps.gc, new Date(at));
};

// Version n of the workspace: its own source and entries, the shared blob.
const version = (n: number): PlanInput => ({
  source: { sha256: hex(`source-v${n}`), size: 1000 + n },
  entries: defaultEntries(`v${n}`),
});

const objectRows = (deps: TestDeps, ...refs: { kind: "source" | "blob"; sha256: string }[]) =>
  deps.store.getStoredObjects(USER, refs);

describe.each(harnesses)("gc (%s)", (_name, makeHarness) => {
  const setup = () => {
    const harness = makeHarness();
    harness.addUser(USER);
    harness.addUser(OTHER);
    return makeTestDeps(harness);
  };

  it("expires lapsed pending sessions, and retires them once their hold ended", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const begun = await begin(deps);
    const held = await gcAt(deps, T + SESSION_TTL_MS - 1);
    expect(held).toMatchObject({ expiredSessions: 0, retiredSessions: 0 });
    expect((await deps.store.getSession(begun.publish.id))?.plan).not.toBe(PLAN_STUB);

    // Lapsed, but within GC's clock-skew margin: a complete whose clock lags
    // GC's may still be committing it.
    const lapsed = await gcAt(deps, T + SESSION_TTL_MS + 1);
    expect(lapsed).toMatchObject({ expiredSessions: 0, retiredSessions: 0 });
    expect(await deps.store.getSession(begun.publish.id)).toMatchObject({ status: "pending" });

    const report = await gcAt(deps, T + SESSION_TTL_MS + GC_CLOCK_SKEW_MARGIN_MS + 1);
    expect(report).toMatchObject({ expiredSessions: 1, retiredSessions: 1 });
    // Retired: its plan stubbed, its held objects dropped, hold_until 0.
    expect(await deps.store.getSession(begun.publish.id)).toMatchObject({
      status: "expired",
      holdUntil: 0,
      plan: PLAN_STUB,
    });
    expect(await deps.store.missingSessionObjects(begun.publish.id)).toEqual([]);
  });

  it("deletes objects no version references once they are a day old, sparing the rest", async () => {
    const deps = setup();
    const T = deps.clock.now;
    for (let n = 1; n <= 6; n++) await publish(deps, version(n));
    // v1 was pruned by the sixth commit: its source is unreferenced now.
    const v1 = { kind: "source" as const, sha256: hex("source-v1") };
    const v2 = { kind: "source" as const, sha256: hex("source-v2") };
    const blob = { kind: "blob" as const, sha256: hex("blob-1") };

    const early = await gcAt(deps, T + SESSION_TTL_MS + HOUR);
    expect(early.deletedObjects).toBe(0);
    expect(await objectRows(deps, v1)).toHaveLength(1); // verified: the 24 h floor applies

    const later = await gcAt(deps, T + DAY + HOUR);
    expect(later.deletedObjects).toBe(1);
    expect(await objectRows(deps, v1)).toEqual([]);
    expect(deps.sourcesBucket.objects.has(sourceKey(USER, v1.sha256))).toBe(false);
    // Referenced by retained versions.
    expect(await objectRows(deps, v2, blob)).toHaveLength(2);
    expect(deps.sourcesBucket.objects.has(blobKey(USER, blob.sha256))).toBe(true);
  });

  it("deletes never-verified objects as soon as no session holds them (Q10)", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const abandoned = await begin(deps, { source: { sha256: hex("orphan"), size: 10 } });
    performUploads(deps, abandoned.uploads);
    (await abortPublish(deps, USER, abandoned.publish.id))._unsafeUnwrap();
    const orphan = { kind: "source" as const, sha256: hex("orphan") };

    // Aborted but still held (its URLs work until hold_until): spared.
    expect((await gcAt(deps, T + HOUR)).deletedObjects).toBe(0);
    expect(await objectRows(deps, orphan)).toHaveLength(1);

    // Hold over, but within GC's clock-skew margin: still spared.
    expect((await gcAt(deps, T + SESSION_TTL_MS + 1)).deletedObjects).toBe(0);
    expect(await objectRows(deps, orphan)).toHaveLength(1);

    // Past the margin: gone, though only 2 h old.
    const report = await gcAt(deps, T + SESSION_TTL_MS + GC_CLOCK_SKEW_MARGIN_MS + 1);
    expect(report.deletedObjects).toBe(2); // the source and the blob
    expect(await objectRows(deps, orphan)).toEqual([]);
    expect(deps.sourcesBucket.objects.has(sourceKey(USER, orphan.sha256))).toBe(false);
    expect(await deps.store.usedBytes(USER)).toBe(0);
  });

  it("spares fresh verified objects even when unreferenced", async () => {
    const deps = setup();
    for (let n = 1; n <= 6; n++) await publish(deps, version(n));
    const v1 = { kind: "source" as const, sha256: hex("source-v1") };
    await gcAt(deps, deps.clock.now + SESSION_TTL_MS + 1);
    expect(await objectRows(deps, v1)).toHaveLength(1);
  });

  it("keeps rows deleting when R2 refuses, and finishes them on the next run", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const abandoned = await begin(deps);
    performUploads(deps, abandoned.uploads);
    deps.sourcesBucket.failDeletes = 2; // the batch and its one retry

    const holdOver = T + SESSION_TTL_MS + GC_CLOCK_SKEW_MARGIN_MS;
    const failed = await gcAt(deps, holdOver + 1);
    expect(failed).toMatchObject({ deletedObjects: 0, failedObjectBatches: 1 });
    const rows = await objectRows(
      deps,
      { kind: "source", sha256: hex("source-1") },
      { kind: "blob", sha256: hex("blob-1") },
    );
    expect(rows.map((r) => [r.deleting, r.verified])).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(await deps.store.usedBytes(USER)).toBe(0); // claimed rows no longer count

    const retried = await gcAt(deps, holdOver + 2);
    expect(retried.deletedObjects).toBe(2);
    expect(deps.sourcesBucket.keys()).toEqual([]);
  });

  it("removes a site's stale keys only after cleanup_after", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const first = await publish(deps, {
      files: [{ path: "old.js" }, { path: "logo.png" }],
      entries: defaultEntries("v1"),
    });
    const slug = first.publish.slug;
    await publish(deps, {
      files: [{ path: "new.js" }, { path: "logo.png" }],
      entries: defaultEntries("v2"),
    });
    const site = await deps.store.findSiteById(first.publish.siteId);
    // The second begin's hold, plus the delay, is the latest schedule.
    expect(site?.cleanupAfter).toBe(T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS);

    await gcAt(deps, T + SESSION_TTL_MS + 30 * 60_000);
    expect(deps.sitesBucket.keys(`${slug}/`)).toContain(`${slug}/old.js`);

    const report = await gcAt(deps, T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1);
    expect(report).toMatchObject({ cleanedSites: 1, deletedSiteKeys: 1 });
    expect(deps.sitesBucket.keys(`${slug}/`)).toEqual(
      ["canvas.json", "index.html", "logo.png", "new.js", "preview.html"].map(
        (p) => `${slug}/${p}`,
      ),
    );
    expect((await deps.store.findSiteById(first.publish.siteId))?.cleanupAfter).toBeNull();
  });

  it("deletes a new path from a session that never completed, after its hold", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const live = await publish(deps, { entries: defaultEntries("v1") });
    const slug = live.publish.slug;
    const stray = await begin(deps, {
      files: [{ path: "stray.js" }, { path: "logo.png" }],
      entries: defaultEntries("v2"),
    });
    performUploads(deps, stray.uploads);
    const holdEnd = T + SESSION_TTL_MS;

    // While held: kept, even past the first commit's schedule.
    await gcAt(deps, holdEnd - 1);
    expect(deps.sitesBucket.keys(`${slug}/`)).toContain(`${slug}/stray.js`);

    await gcAt(deps, holdEnd + SITE_CLEANUP_DELAY_MS + 1);
    const keys = deps.sitesBucket.keys(`${slug}/`);
    expect(keys).not.toContain(`${slug}/stray.js`);
    // The live version's files stay (logo.png was only overwritten).
    expect(keys).toEqual(
      expect.arrayContaining([`${slug}/assets/index-AbC12345.js`, `${slug}/logo.png`]),
    );
  });

  it("keeps an uncommitted session's paths until its hold ended GC's clock-skew margin ago", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const live = await publish(deps, { entries: defaultEntries("v1") });
    const slug = live.publish.slug;
    const late = await begin(deps, {
      files: [{ path: "late.js" }, { path: "logo.png" }],
      entries: defaultEntries("v2"),
    });
    performUploads(deps, late.uploads);
    const holdEnd = T + SESSION_TTL_MS;
    // Visited early (as a site whose cleanup was put off for a day would be).
    const due = deps.store.sitesDueForCleanup;
    deps.store.sitesDueForCleanup = async () => [{ id: live.publish.siteId, slug }];

    // GC's clock reads the hold over; a lagging complete's may not. (A
    // minute inside the margin: a site visit reads GC's clock as the run's
    // start plus the real time elapsed, which a loaded test machine stretches.)
    const within = await gcAt(deps, holdEnd + GC_CLOCK_SKEW_MARGIN_MS - 60_000);
    expect(within.cleanedSites).toBe(1);
    expect(deps.sitesBucket.keys(`${slug}/`)).toContain(`${slug}/late.js`);

    await gcAt(deps, holdEnd + GC_CLOCK_SKEW_MARGIN_MS + 1);
    deps.store.sitesDueForCleanup = due;
    expect(deps.sitesBucket.keys(`${slug}/`)).not.toContain(`${slug}/late.js`);
  });

  it("skips a site whose lock is held, and a site protected with *", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const one = await publish(deps, { files: [{ path: "a.js" }], entries: defaultEntries("1") });
    await publish(deps, { files: [{ path: "b.js" }], entries: defaultEntries("2") });
    const siteId = one.publish.siteId;
    const at = T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1;

    expect(await deps.store.claimSiteLockForGc(siteId, "pub_other", at, at + HOUR)).toBe(true);
    const skipped = await gcAt(deps, at);
    expect(skipped).toMatchObject({ skippedSites: 1, deletedSiteKeys: 0 });
    await deps.store.releaseCompleteLock(siteId, "pub_other");

    // "*" while a live entry matches neither the head nor any session's plan,
    // and is recent: its references are unknowable, so nothing is deleted.
    const slug = one.publish.slug;
    deps.sitesBucket.upload(`${slug}/preview.html`, {
      size: 5,
      sha256: hex("unknown-entry"),
      uploaded: new Date(at),
    });
    await deps.harness.setProtected(siteId, "*");
    const starred = await gcAt(deps, at + 1);
    expect(starred.deletedSiteKeys).toBe(0);
    expect(deps.sitesBucket.keys(`${one.publish.slug}/`)).toContain(`${one.publish.slug}/a.js`);
    expect((await deps.store.findSiteById(siteId))?.cleanupAfter).toBe(at + 1 + DAY);
  });

  it("keeps live_files, protected_files and held sessions' paths", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const one = await publish(deps, { files: [{ path: "live.js" }], entries: defaultEntries("1") });
    const slug = one.publish.slug;
    for (const path of ["protected.js", "held.js", "stale.js"]) {
      deps.sitesBucket.upload(`${slug}/${path}`, { size: 1, sha256: hex(path) });
    }
    await deps.harness.setProtected(one.publish.siteId, JSON.stringify(["protected.js"]));
    const at = T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1;
    // A begin lands after GC picked the site: its plan's paths are kept.
    const due = deps.store.sitesDueForCleanup;
    deps.store.sitesDueForCleanup = async (now, deferredBefore, limit) => {
      const sites = await due(now, deferredBefore, limit);
      await begin(deps, { files: [{ path: "held.js" }], entries: defaultEntries("2") });
      return sites;
    };
    await gcAt(deps, at);
    deps.store.sitesDueForCleanup = due;
    expect(deps.sitesBucket.keys(`${slug}/`)).toEqual(
      ["canvas.json", "held.js", "index.html", "live.js", "preview.html", "protected.js"].map(
        (p) => `${slug}/${p}`,
      ),
    );
  });

  it("keeps a schedule a begin wrote while GC was cleaning", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const one = await publish(deps);
    const at = T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1;
    const held = deps.store.heldSessionPlans;
    let bumped = 0;
    deps.store.heldSessionPlans = async (siteId, now) => {
      deps.clock.now = at;
      const begun = await begin(deps, { entries: defaultEntries("racer") });
      bumped = Date.parse(begun.publish.expiresAt) + SITE_CLEANUP_DELAY_MS;
      return held(siteId, now);
    };
    await runGc(deps.gc, new Date(at));
    deps.store.heldSessionPlans = held;
    expect((await deps.store.findSiteById(one.publish.siteId))?.cleanupAfter).toBe(bumped);
  });

  it(`visits at most ${GC_SITES_PER_RUN} sites per run`, async () => {
    const deps = setup();
    const T = deps.clock.now;
    // Two accounts: one may hold at most 50 sites.
    for (let i = 0; i < GC_SITES_PER_RUN + 1; i++) {
      const user = i % 2 === 0 ? USER : OTHER;
      const begun = (
        await beginPublish(deps, user, await beginRequest({ workspace: workspaceId(i) }))
      )._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      (await completePublish(deps, user, begun.publish.id, completeRequest()))._unsafeUnwrap();
    }
    const at = T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1;
    expect((await gcAt(deps, at)).cleanedSites).toBe(GC_SITES_PER_RUN);
    expect((await gcAt(deps, at + 1)).cleanedSites).toBe(1);
  });

  it("forgets old finished sessions and deletes sites that never completed", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const kept = await publish(deps);
    const never = await begin(deps, { workspace: workspaceId(7), name: "Never Done" });
    performUploads(deps, never.uploads);
    const neverSlug = never.publish.slug;
    expect(deps.sitesBucket.keys(`${neverSlug}/`).length).toBeGreaterThan(0);

    const report = await gcAt(deps, T + 8 * DAY);
    expect(report.deletedSessions).toBe(2); // the completed one and the expired one
    expect(report.deletedAbandonedSites).toBe(1);
    expect(await deps.store.findSiteBySlug(neverSlug)).toBeNull();
    expect(deps.sitesBucket.keys(`${neverSlug}/`)).toEqual([]);
    expect(await deps.store.findSiteById(kept.publish.siteId)).not.toBeNull();
    expect(await deps.store.getSession(kept.publish.id)).toBeNull();
  });

  it("does not stop at a failing step", async () => {
    const deps = setup();
    await begin(deps);
    const expire = deps.store.expireSessions;
    deps.store.expireSessions = async () => {
      throw new Error("D1 down");
    };
    const report = await gcAt(deps, deps.clock.now + 8 * DAY);
    deps.store.expireSessions = expire;
    expect(report.errors).toEqual(["expire-sessions"]);
    expect(report.deletedObjects).toBe(2);
  });
  it("claims objects across accounts in turns, so one account cannot fill a run", async () => {
    const deps = setup();
    const T = deps.clock.now;
    // USER's six never-uploaded objects are older than OTHER's two.
    await begin(deps, {
      largeFiles: [1, 2, 3, 4, 5].map((n) => ({
        path: `f${n}.bin`,
        sha256: hex(`flood-${n}`),
        size: MiB,
      })),
    });
    deps.clock.now = T + 60_000;
    (
      await beginPublish(deps, OTHER, await beginRequest({ source: { sha256: hex("o"), size: 5 } }))
    )._unsafeUnwrap();
    deps.gc.limits = { objectsPerRun: 2 };

    const report = await gcAt(deps, T + SESSION_TTL_MS + HOUR);
    expect(report.deletedObjects).toBe(2);
    expect(report.backlog).toContain("objects");
    // One of each account's: OTHER's oldest went in the first run.
    expect(await deps.store.usedBytes(OTHER)).toBe(2 * MiB);
    expect(await deps.store.usedBytes(USER)).toBe(5 * MiB);
  });

  it("deletes a run's objects in several R2 batches, and continues next run", async () => {
    const deps = setup();
    const T = deps.clock.now;
    await begin(deps, {
      largeFiles: [1, 2, 3, 4, 5].map((n) => ({
        path: `f${n}.bin`,
        sha256: hex(`b${n}`),
        size: MiB,
      })),
    });
    deps.gc.limits = { objectsPerRun: 4, deleteBatch: 3 };

    const first = await gcAt(deps, T + SESSION_TTL_MS + HOUR);
    expect(first).toMatchObject({ deletedObjects: 4, backlog: ["objects"] });
    expect(deps.sourcesBucket.deletes.map((keys) => keys.length)).toEqual([3, 1]);
    const second = await gcAt(deps, T + SESSION_TTL_MS + 2 * HOUR);
    expect(second).toMatchObject({ deletedObjects: 2, backlog: [] });
    expect(await deps.store.usedBytes(USER)).toBe(0);
  });

  it("leaves claimed objects for the next run when the run's time is up", async () => {
    const deps = setup();
    const T = deps.clock.now;
    await begin(deps);
    deps.gc.limits = { runBudgetMs: -1 };
    const out = await gcAt(deps, T + SESSION_TTL_MS + HOUR);
    expect(out).toMatchObject({ deletedObjects: 0 });
    expect(out.backlog).toContain("objects");
    expect(await deps.store.leftoverDeletingObjects(10)).toHaveLength(2);

    deps.gc.limits = {};
    expect((await gcAt(deps, T + SESSION_TTL_MS + 2 * HOUR)).deletedObjects).toBe(2);
  });

  it("gives abandoned sites their own budget, apart from site cleanup", async () => {
    const deps = setup();
    const T = deps.clock.now;
    await publish(deps);
    const never = await begin(deps, { workspace: workspaceId(7), name: "Never Done" });
    deps.gc.limits = { sitesPerRun: 1 };
    // Both sites are due for cleanup; the one visit goes to the older.
    const report = await gcAt(deps, T + 8 * DAY);
    expect(report.cleanedSites).toBe(1);
    expect(report.deletedAbandonedSites).toBe(1);
    expect(await deps.store.findSiteBySlug(never.publish.slug)).toBeNull();
  });

  it("visits a site whose cleanup begins keep pushing out, once it has waited a day", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const live = await publish(deps);
    const slug = live.publish.slug;
    deps.sitesBucket.upload(`${slug}/junk.js`, { size: 1, sha256: hex("junk") });
    // A begin every hour (each aborted, holding nothing) keeps cleanup_after
    // three hours ahead, so it never passes by itself.
    for (let h = 1; h <= 26; h++) {
      deps.clock.now = T + h * HOUR;
      const again = await begin(deps);
      (await abortPublish(deps, USER, again.publish.id))._unsafeUnwrap();
      const site = await deps.store.findSiteById(live.publish.siteId);
      expect(site!.cleanupAfter).toBeGreaterThan(T + h * HOUR + 1);
      const report = await gcAt(deps, T + h * HOUR + 1);
      const gone = !deps.sitesBucket.keys(`${slug}/`).includes(`${slug}/junk.js`);
      expect(gone).toBe(h * HOUR + 1 > GC_MAX_CLEANUP_DEFER_MS);
      if (gone) {
        expect(report.cleanedSites).toBe(1);
        break;
      }
    }
    expect(deps.sitesBucket.keys(`${slug}/`)).not.toContain(`${slug}/junk.js`);
  });

  it("deletes stale keys as it lists, one batch at a time", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const live = await publish(deps);
    const slug = live.publish.slug;
    for (let i = 0; i < 7; i++) {
      deps.sitesBucket.upload(`${slug}/junk-${i}.js`, { size: 1, sha256: hex(`junk-${i}`) });
    }
    deps.gc.limits = { deleteBatch: 2 };
    const listsAtDelete: number[] = [];
    const del = deps.sitesBucket.delete.bind(deps.sitesBucket);
    deps.sitesBucket.delete = async (keys: string | string[]) => {
      listsAtDelete.push(deps.sitesBucket.lists);
      return del(keys);
    };
    deps.sitesBucket.lists = 0;
    const report = await gcAt(deps, T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1);
    expect(report.deletedSiteKeys).toBe(7);
    expect(deps.sitesBucket.deletes.every((keys) => keys.length <= 2)).toBe(true);
    // The first delete happened before the listing was done (13 keys, 3 a page).
    expect(listsAtDelete[0]).toBeLessThan(deps.sitesBucket.lists);
    expect(deps.sitesBucket.keys(`${slug}/`)).toHaveLength(6);
  });

  it("stops a visit at its key limit, leaves the site due, and finishes on later runs", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const live = await publish(deps);
    const slug = live.publish.slug;
    for (let i = 0; i < 9; i++) {
      deps.sitesBucket.upload(`${slug}/junk-${i}.js`, { size: 1, sha256: hex(`junk-${i}`) });
    }
    deps.gc.limits = { siteKeysPerVisit: 8, deleteBatch: 2 };
    const at = T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1;
    const due = (await deps.store.findSiteById(live.publish.siteId))!.cleanupAfter;

    const first = await gcAt(deps, at);
    expect(first.backlog).toContain("site-cleanup");
    expect(first.cleanedSites).toBe(0);
    expect(first.deletedSiteKeys).toBeGreaterThan(0);
    expect((await deps.store.findSiteById(live.publish.siteId))!.cleanupAfter).toBe(due);

    // Each run gets further (the 6 kept keys are listed again every time).
    let last = first;
    for (let run = 1; run < 5 && last.cleanedSites === 0; run++) {
      last = await gcAt(deps, at + run * HOUR);
    }
    expect(last).toMatchObject({ cleanedSites: 1, backlog: [] });
    expect(deps.sitesBucket.keys(`${slug}/`)).toHaveLength(6); // the live files
    expect((await deps.store.findSiteById(live.publish.siteId))!.cleanupAfter).toBeNull();
  });

  it("forgets uncommitted sessions a day after they expire, committed ones after 7 days", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const done = await publish(deps);
    const dropped = await begin(deps, { entries: defaultEntries("v2") });
    const report = await gcAt(deps, T + SESSION_TTL_MS + DAY + 1);
    expect(report.deletedSessions).toBe(1);
    expect(await deps.store.getSession(dropped.publish.id)).toBeNull();
    expect(await deps.store.getSession(done.publish.id)).not.toBeNull();
    expect((await gcAt(deps, T + 8 * DAY)).deletedSessions).toBe(1);
    expect(await deps.store.getSession(done.publish.id)).toBeNull();
  });

  it("runs site cleanup alone on the five-minute cron", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const live = await publish(deps);
    const slug = live.publish.slug;
    deps.sitesBucket.upload(`${slug}/junk.js`, { size: 1, sha256: hex("junk") });
    const lapsed = await begin(deps, { workspace: workspaceId(2), name: "Lapsed" });
    const at = T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1;

    deps.clock.now = at;
    const report = await runGc(deps.gc, new Date(at), gcModeFor(GC_SITE_CLEANUP_CRON));
    // Both sites were due (the lapsed begin scheduled its own).
    expect(report).toMatchObject({ cleanedSites: 2, deletedSiteKeys: 1 });
    expect(deps.sitesBucket.keys(`${slug}/`)).not.toContain(`${slug}/junk.js`);
    // No other step ran: the lapsed session is still pending and holds its objects.
    expect(report).toMatchObject({ expiredSessions: 0, retiredSessions: 0, deletedObjects: 0 });
    expect((await deps.store.getSession(lapsed.publish.id))?.status).toBe("pending");

    expect(gcModeFor(GC_CRON)).toBe("full");
    expect(gcModeFor("0 3 * * *")).toBe("full");
    const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    expect(wrangler).toContain(`"crons": ["${GC_CRON}", "${GC_SITE_CLEANUP_CRON}"]`);
  });

  it("puts a site that begin refused for its stale keys at the front of the cleanup queue", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const big = (path: string) => ({ path, size: 450 * MiB, immutable: true });
    // Another site, wanted earlier, keeps GC's one visit per run busy.
    await publish(deps, { workspace: workspaceId(2), name: "Older" });
    deps.clock.now = T + 4 * HOUR;
    const v1 = await publish(deps, { files: [big("assets/a.js")], entries: defaultEntries("1") });
    await publish(deps, { files: [big("assets/b.js")], entries: defaultEntries("2") });
    await publish(deps, { files: [big("assets/c.js")], entries: defaultEntries("3") });
    const slug = v1.publish.slug;
    const refusedAt = deps.clock.now;
    const v4 = { files: [big("assets/d.js")], entries: defaultEntries("4") };
    const refused = await beginPublish(deps, USER, await beginRequest(v4));
    expect(refused._unsafeUnwrapErr()).toMatchObject({
      code: "SITE_TOO_LARGE",
      details: { reason: "stored", limitBytes: MAX_SITE_STORED_BYTES },
    });

    // An hour on, the one visit a run allows goes to the blocked site, ahead
    // of the older one and before its own cleanup_after (v3's begin, 3 h).
    deps.gc.limits = { sitesPerRun: 1 };
    const at = refusedAt + SITE_CLEANUP_DELAY_MS + 1;
    deps.clock.now = at;
    const report = await runGc(deps.gc, new Date(at), "sites");
    expect(report).toMatchObject({ cleanedSites: 1, deletedSiteKeys: 2 });
    expect(deps.sitesBucket.keys(`${slug}/`)).not.toContain(`${slug}/assets/a.js`);
    expect((await beginPublish(deps, USER, await beginRequest(v4))).isOk()).toBe(true);
  });

  it("keeps a switch-over's replaced files an hour, though the site was hurried before the commit", async () => {
    const deps = setup();
    const big = (path: string, size = 450 * MiB) => ({ path, size, immutable: true });
    const v1 = await publish(deps, { files: [big("assets/a.js")], entries: defaultEntries("1") });
    await publish(deps, { files: [big("assets/b.js")], entries: defaultEntries("2") });
    await publish(deps, { files: [big("assets/c.js")], entries: defaultEntries("3") });
    const slug = v1.publish.slug;
    const refusedAt = deps.clock.now;
    const refused = await beginPublish(
      deps,
      USER,
      await beginRequest({ files: [big("assets/d.js")], entries: defaultEntries("4") }),
    );
    expect(refused._unsafeUnwrapErr().message).toMatch(/Try again in an hour/);

    // A smaller v4 fits, and replaces c.js 5 minutes before the hurried visit.
    deps.clock.now = refusedAt + 55 * 60_000;
    const committedAt = deps.clock.now;
    await publish(deps, { files: [big("assets/d.js", 90 * MiB)], entries: defaultEntries("4") });

    const hurried = await gcAt(deps, refusedAt + SITE_CLEANUP_DELAY_MS + 1);
    expect(hurried.deletedSiteKeys).toBe(0);
    expect(deps.sitesBucket.keys(`${slug}/`)).toContain(`${slug}/assets/c.js`);

    await gcAt(deps, committedAt + SITE_CLEANUP_DELAY_MS + 1);
    const keys = deps.sitesBucket.keys(`${slug}/`);
    for (const gone of ["a", "b", "c"]) expect(keys).not.toContain(`${slug}/assets/${gone}.js`);
    expect(keys).toContain(`${slug}/assets/d.js`);
  });

  describe('a protected "*"', () => {
    // v1 is live; v2's complete wrote preview.html, then failed on
    // canvas.json, and its union of protected paths was too large ("*").
    const halfPublished = async (deps: TestDeps) => {
      const v1 = await publish(deps, { files: [{ path: "a.js" }], entries: defaultEntries("1") });
      const v2 = await begin(deps, { files: [{ path: "b.js" }], entries: defaultEntries("2") });
      performUploads(deps, v2.uploads);
      deps.sitesBucket.failPut = (key) => key.endsWith("/canvas.json");
      const failed = await completePublish(
        deps,
        USER,
        v2.publish.id,
        completeRequest(defaultEntries("2")),
      );
      expect(failed._unsafeUnwrapErr().code).toBe("STORAGE_FAILED");
      deps.sitesBucket.failPut = () => false;
      await deps.harness.setProtected(v1.publish.siteId, "*");
      const slug = v1.publish.slug;
      deps.sitesBucket.upload(`${slug}/junk.js`, { size: 1, sha256: hex("junk") });
      return { siteId: v1.publish.siteId, slug, v2 };
    };

    it("is resolved from the live entries: the failed plan's paths stay, junk goes", async () => {
      const deps = setup();
      const T = deps.clock.now;
      const { siteId, slug, v2 } = await halfPublished(deps);
      // A run after v2's hold ended retires the session but keeps its plan:
      // the site is "*".
      await gcAt(deps, T + SESSION_TTL_MS + 1);
      expect((await deps.store.getSession(v2.publish.id))?.plan).not.toBe(PLAN_STUB);

      const report = await gcAt(deps, T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1);
      expect(report.deletedSiteKeys).toBe(1);
      const keys = deps.sitesBucket.keys(`${slug}/`);
      expect(keys).not.toContain(`${slug}/junk.js`);
      expect(keys).toEqual(expect.arrayContaining([`${slug}/a.js`, `${slug}/b.js`]));
      // Stored: later visits, and session retirement, no longer need the plan.
      const site = await deps.store.findSiteById(siteId);
      expect(JSON.parse(site!.protectedFiles!)).toEqual([
        "b.js",
        "canvas.json",
        "index.html",
        "preview.html",
      ]);
      await gcAt(deps, T + SESSION_TTL_MS + DAY + 2);
      expect(await deps.store.getSession(v2.publish.id)).toBeNull();
    });

    it("keeps only the plans that account for the live entries, while the site stays *", async () => {
      const deps = setup();
      const T = deps.clock.now;
      const { siteId, slug, v2 } = await halfPublished(deps);
      // live_files leaves no room in the row for a protected list: "*" stays.
      await deps.harness.setLiveFiles(
        siteId,
        JSON.stringify([
          "a.js",
          "canvas.json",
          "index.html",
          "preview.html",
          "x".repeat(1_899_950),
        ]),
      );
      const plans = async () => (await deps.harness.sessionRows(USER)).planBytes;

      // v2 begun again and aborted at once, over and over: nothing to upload,
      // never wrote entries, so its plan is not kept.
      const before = await plans();
      for (let i = 0; i < 5; i++) {
        const again = await begin(deps, {
          files: [{ path: "b.js" }],
          entries: defaultEntries("2"),
        });
        expect(again.uploads).toEqual([]);
        (await abortPublish(deps, USER, again.publish.id))._unsafeUnwrap();
      }
      expect(await plans()).toBe(before + 5 * PLAN_STUB.length);

      // v3's complete got as far as writing entries, but its first write failed.
      const v3 = await begin(deps, { files: [{ path: "c.js" }], entries: defaultEntries("3") });
      performUploads(deps, v3.uploads);
      deps.sitesBucket.failPut = (key) => key.endsWith("/preview.html");
      const failed = await completePublish(
        deps,
        USER,
        v3.publish.id,
        completeRequest(defaultEntries("3")),
      );
      expect(failed._unsafeUnwrapErr().code).toBe("STORAGE_FAILED");
      deps.sitesBucket.failPut = () => false;

      // Retired, both kept: either might account for a live entry.
      await gcAt(deps, T + SESSION_TTL_MS + GC_CLOCK_SKEW_MARGIN_MS + 1);
      expect((await deps.store.getSession(v2.publish.id))?.plan).not.toBe(PLAN_STUB);
      expect((await deps.store.getSession(v3.publish.id))?.plan).not.toBe(PLAN_STUB);

      // The visit resolves "*" from v2's plan (its preview.html is live), and
      // v3's goes, though the site stays "*".
      const report = await gcAt(
        deps,
        T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + GC_CLOCK_SKEW_MARGIN_MS + 1,
      );
      expect((await deps.store.findSiteById(siteId))?.protectedFiles).toBe("*");
      expect((await deps.store.getSession(v2.publish.id))?.plan).not.toBe(PLAN_STUB);
      expect((await deps.store.getSession(v3.publish.id))?.plan).toBe(PLAN_STUB);
      const keys = deps.sitesBucket.keys(`${slug}/`);
      expect(keys).toEqual(expect.arrayContaining([`${slug}/a.js`, `${slug}/b.js`]));
      expect(keys).not.toContain(`${slug}/c.js`);
      expect(keys).not.toContain(`${slug}/junk.js`);
      expect(report.deletedSiteKeys).toBe(2);

      // Now forgotten like any other uncommitted session.
      await gcAt(deps, T + SESSION_TTL_MS + DAY + 2 * HOUR);
      expect(await deps.store.getSession(v3.publish.id)).toBeNull();
      expect(await deps.store.getSession(v2.publish.id)).not.toBeNull();
    });

    it("stops protecting an entry nothing accounts for once it is old enough", async () => {
      const deps = setup();
      const T = deps.clock.now;
      const { siteId, slug } = await halfPublished(deps);
      // The failed session is gone, so preview.html matches nothing.
      const unknown = { size: 5, sha256: hex("unknown"), uploaded: new Date(T) };
      deps.sitesBucket.upload(`${slug}/preview.html`, unknown);
      const soon = await gcAt(deps, T + SESSION_TTL_MS + SITE_CLEANUP_DELAY_MS + 1);
      expect(soon.deletedSiteKeys).toBe(0);
      expect((await deps.store.findSiteById(siteId))?.protectedFiles).toBe("*");

      const later = await gcAt(deps, T + GC_UNRESOLVED_ENTRY_MAX_AGE_MS + DAY);
      expect(deps.sitesBucket.keys(`${slug}/`)).not.toContain(`${slug}/junk.js`);
      expect(deps.sitesBucket.keys(`${slug}/`)).toContain(`${slug}/a.js`);
      expect(later.deletedSiteKeys).toBeGreaterThan(0);
      expect((await deps.store.findSiteById(siteId))?.protectedFiles).toBeNull();
    });
  });
});

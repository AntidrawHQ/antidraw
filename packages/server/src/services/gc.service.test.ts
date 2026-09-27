import { describe, expect, it } from "vitest";
import { GC_SITES_PER_RUN, SESSION_TTL_MS, SITE_CLEANUP_DELAY_MS } from "../lib/publish-limits";
import { blobKey, sourceKey } from "../lib/storage";
import {
  beginRequest,
  completeRequest,
  defaultEntries,
  harnesses,
  hex,
  makeTestDeps,
  performUploads,
  workspaceId,
  type PlanInput,
  type TestDeps,
} from "../test/publish-harness";
import { runGc } from "./gc.service";
import { abortPublish, beginPublish, completePublish } from "./publish.service";

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

  it("expires lapsed pending sessions without ending their hold", async () => {
    const deps = setup();
    const begun = await begin(deps);
    const report = await gcAt(deps, deps.clock.now + SESSION_TTL_MS + 1);
    expect(report.expiredSessions).toBe(1);
    expect(await deps.store.getSession(begun.publish.id)).toMatchObject({
      status: "expired",
      holdUntil: begun.publish.expiresAt ? Date.parse(begun.publish.expiresAt) : 0,
    });
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

    // Hold over: gone, though only 2 h old.
    const report = await gcAt(deps, T + SESSION_TTL_MS + 1);
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

    const failed = await gcAt(deps, T + SESSION_TTL_MS + 1);
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

    const retried = await gcAt(deps, T + SESSION_TTL_MS + 2);
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
    deps.store.sitesDueForCleanup = async (now, limit) => {
      const sites = await due(now, limit);
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
});

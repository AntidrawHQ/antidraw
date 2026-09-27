import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GC_CLOCK_SKEW_MARGIN_MS, GC_CRON, SESSION_TTL_MS } from "../lib/publish-limits";
import { blobKey, pointerKey, siteContentKey, sourceKey } from "../lib/storage";
import {
  beginRequest,
  defaultEntries,
  harnesses,
  hex,
  makeTestDeps,
  MiB,
  performUploads,
  pointerOf,
  workspaceId,
  type PlanInput,
  type TestDeps,
} from "../test/publish-harness";
import { sha256Hex } from "../test/memory-object-store";
import { runGc } from "./gc.service";
import { abortPublish, beginPublish, completePublish } from "./publish.service";
import { PLAN_STUB, type ObjectKind } from "./publish.store";

const USER = "user-1";
const OTHER = "user-2";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const begin = async (deps: TestDeps, input: PlanInput = {}) =>
  (await beginPublish(deps, USER, await beginRequest(input)))._unsafeUnwrap();

const publish = async (deps: TestDeps, input: PlanInput = {}) => {
  const begun = await begin(deps, input);
  performUploads(deps, begun.uploads);
  (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap();
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

const objectRows = (deps: TestDeps, ...refs: { kind: ObjectKind; sha256: string }[]) =>
  deps.store.getStoredObjects(USER, refs);

// The default plan's objects: its source, its blob, and six site contents
// (three files and the three entry pages).
const PLAN_OBJECTS = 8;

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
    // And the entry pages of v1 to v5: the pointer moved past those versions,
    // and a pointer keeps only immutable paths of older versions.
    expect(later.deletedObjects).toBe(1 + 5 * 3);
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
    expect(report.deletedObjects).toBe(PLAN_OBJECTS);
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
    expect(retried.deletedObjects).toBe(PLAN_OBJECTS);
    expect(deps.sourcesBucket.keys()).toEqual([]);
    expect(deps.sitesBucket.keys()).toEqual([]);
  });

  it("deletes site contents no retained version lists, and keeps the pointer's", async () => {
    const deps = setup();
    const T = deps.clock.now;
    // Each version has its own hashed chunk; the pointer keeps the chunks of
    // the previous versions it retains as grace entries.
    const chunk = (n: number) => ({
      path: `assets/chunk-v${n}AAAAAA.js`,
      immutable: true,
      contentType: "text/javascript",
    });
    let slug = "";
    for (let n = 1; n <= 6; n++) {
      slug = (await publish(deps, { ...version(n), files: [chunk(n), { path: "logo.png" }] }))
        .publish.slug;
    }
    const pointer = pointerOf(deps, slug)!;
    expect(pointer.version).toBe(6);
    expect(Object.keys(pointer.files).sort()).toEqual(
      [
        "assets/chunk-v2AAAAAA.js",
        "assets/chunk-v3AAAAAA.js",
        "assets/chunk-v4AAAAAA.js",
        "assets/chunk-v5AAAAAA.js",
        "assets/chunk-v6AAAAAA.js",
        "canvas.json",
        "index.html",
        "logo.png",
        "preview.html",
      ].sort(),
    );

    // v1 was pruned: its chunk and its source are unreferenced, and so are the
    // entry pages of v1 to v5 (the pointer moved past those versions, and
    // keeps only their chunks); they go once a day old. logo.png is every
    // version's.
    const v1 = [
      hex("site-assets/chunk-v1AAAAAA.js"),
      await sha256Hex(defaultEntries("v1")["index.html"]),
    ];
    expect((await gcAt(deps, T + SESSION_TTL_MS + HOUR)).deletedObjects).toBe(0);
    const report = await gcAt(deps, T + DAY + HOUR);
    expect(report.deletedObjects).toBe(2 + 5 * 3); // source, chunk, 5 x three entry pages
    for (const sha of v1) {
      expect(deps.sitesBucket.objects.has(siteContentKey(USER, sha))).toBe(false);
    }
    for (const path of Object.keys(pointer.files)) {
      const key = siteContentKey(USER, pointer.files[path].h);
      expect(deps.sitesBucket.objects.has(key), path).toBe(true);
    }
    expect(pointerOf(deps, slug)?.version).toBe(6);
  });

  it("deletes the site contents of a publish that never completed, once its hold ends", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const begun = await begin(deps);
    performUploads(deps, begun.uploads);
    expect(deps.sitesBucket.keys(`c/${USER}/`)).toHaveLength(6);
    expect((await gcAt(deps, T + SESSION_TTL_MS + 1)).deletedObjects).toBe(0);
    const report = await gcAt(deps, T + SESSION_TTL_MS + GC_CLOCK_SKEW_MARGIN_MS + 1);
    expect(report.deletedObjects).toBe(PLAN_OBJECTS);
    expect(deps.sitesBucket.keys()).toEqual([]);
    expect(deps.sourcesBucket.keys()).toEqual([]);
    // Nothing visitors could see was ever written.
    expect(pointerOf(deps, begun.publish.slug)).toBeNull();
  });

  it("re-syncs a pointer left behind by a complete whose switch-over failed", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const first = await publish(deps, version(1));
    const slug = first.publish.slug;
    const second = await begin(deps, version(2));
    performUploads(deps, second.uploads);
    deps.sitesBucket.failPut = (key) => key === pointerKey(slug);
    expect((await completePublish(deps, USER, second.publish.id))._unsafeUnwrapErr()).toMatchObject(
      { status: 500, code: "STORAGE_FAILED" },
    );
    deps.sitesBucket.failPut = () => false;
    expect(pointerOf(deps, slug)?.version).toBe(1);
    expect(await deps.store.findSiteById(first.publish.siteId)).toMatchObject({
      headVersion: 2,
      pointerVersion: 1,
    });

    const report = await gcAt(deps, T + HOUR);
    expect(report.syncedPointers).toBe(1);
    expect(pointerOf(deps, slug)?.version).toBe(2);
    expect(pointerOf(deps, slug)?.files["index.html"].h).toBe(
      await sha256Hex(defaultEntries("v2")["index.html"]),
    );
    expect((await deps.store.findSiteById(first.publish.siteId))?.pointerVersion).toBe(2);
    expect((await gcAt(deps, T + 2 * HOUR)).syncedPointers).toBe(0);
  });

  it("only records a pointer someone else already brought up to date", async () => {
    const deps = setup();
    const first = await publish(deps, version(1));
    const slug = first.publish.slug;
    const second = await begin(deps, version(2));
    performUploads(deps, second.uploads);
    deps.sitesBucket.failPut = (key) => key === pointerKey(slug);
    await completePublish(deps, USER, second.publish.id);
    deps.sitesBucket.failPut = () => false;
    // A concurrent writer (the app's retry) put the head meanwhile, but its
    // record of it was lost.
    const pointer = pointerOf(deps, slug)!;
    const text = JSON.stringify({ ...pointer, version: 2 });
    await deps.sites.put(pointerKey(slug), new TextEncoder().encode(text), {
      size: text.length,
      sha256: await sha256Hex(text),
      contentType: "application/json",
    });
    const writes = deps.sitesBucket.writes.length;
    expect((await gcAt(deps, deps.clock.now + HOUR)).syncedPointers).toBe(1);
    expect(deps.sitesBucket.writes.length).toBe(writes);
    expect((await deps.store.findSiteById(first.publish.siteId))?.pointerVersion).toBe(2);
  });

  it(`re-syncs at most its limit of pointers per run, and the rest next run`, async () => {
    const deps = setup();
    const T = deps.clock.now;
    deps.sitesBucket.failPut = (key) => key.startsWith("m/");
    for (let n = 1; n <= 3; n++) {
      const begun = await begin(deps, { workspace: workspaceId(n), name: `Site ${n}` });
      performUploads(deps, begun.uploads);
      await completePublish(deps, USER, begun.publish.id);
    }
    deps.sitesBucket.failPut = () => false;
    deps.gc.limits = { pointerSyncsPerRun: 2 };
    const first = await gcAt(deps, T + HOUR);
    expect(first).toMatchObject({ syncedPointers: 2 });
    expect(first.backlog).toContain("pointers");
    expect(await gcAt(deps, T + 2 * HOUR)).toMatchObject({ syncedPointers: 1, backlog: [] });
    expect(deps.sitesBucket.keys("m/")).toHaveLength(3);
  });

  it("forgets old finished sessions and deletes sites that never completed", async () => {
    const deps = setup();
    const T = deps.clock.now;
    const kept = await publish(deps);
    const never = await begin(deps, { workspace: workspaceId(7), name: "Never Done" });
    performUploads(deps, never.uploads);
    const neverSlug = never.publish.slug;
    // Nothing should serve a slug once it is free, whatever left a pointer.
    deps.sitesBucket.upload(pointerKey(neverSlug), { size: 2, sha256: hex("stray") });

    const report = await gcAt(deps, T + 8 * DAY);
    expect(report.deletedSessions).toBe(2); // the completed one and the expired one
    expect(report.deletedAbandonedSites).toBe(1);
    expect(await deps.store.findSiteBySlug(neverSlug)).toBeNull();
    expect(deps.sitesBucket.objects.has(pointerKey(neverSlug))).toBe(false);
    expect(pointerOf(deps, kept.publish.slug)?.version).toBe(1);
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
    expect(report.deletedObjects).toBe(PLAN_OBJECTS);
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

    // The source and five blobs first (oldest, then in order), then the six
    // site contents; a batch spanning both buckets deletes from each.
    const first = await gcAt(deps, T + SESSION_TTL_MS + HOUR);
    expect(first).toMatchObject({ deletedObjects: 4, backlog: ["objects"] });
    expect(deps.sourcesBucket.deletes.map((keys) => keys.length)).toEqual([3, 1]);
    const second = await gcAt(deps, T + SESSION_TTL_MS + 2 * HOUR);
    expect(second).toMatchObject({ deletedObjects: 4, backlog: ["objects"] });
    expect(deps.sourcesBucket.deletes.map((keys) => keys.length)).toEqual([3, 1, 2]);
    expect(deps.sitesBucket.deletes.map((keys) => keys.length)).toEqual([1, 1]);
    const third = await gcAt(deps, T + SESSION_TTL_MS + 3 * HOUR);
    expect(third).toMatchObject({ deletedObjects: 4 });
    expect(await deps.store.leftoverDeletingObjects(10)).toEqual([]);
    expect(await deps.store.usedBytes(USER)).toBe(0);
    expect(deps.sitesBucket.keys()).toEqual([]);
  });

  it("leaves claimed objects for the next run when the run's time is up", async () => {
    const deps = setup();
    const T = deps.clock.now;
    await begin(deps);
    deps.gc.limits = { runBudgetMs: -1 };
    const out = await gcAt(deps, T + SESSION_TTL_MS + HOUR);
    expect(out).toMatchObject({ deletedObjects: 0 });
    expect(out.backlog).toContain("objects");
    expect(await deps.store.leftoverDeletingObjects(10)).toHaveLength(PLAN_OBJECTS);

    deps.gc.limits = {};
    expect((await gcAt(deps, T + SESSION_TTL_MS + 2 * HOUR)).deletedObjects).toBe(PLAN_OBJECTS);
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

  it("runs hourly, from the one cron trigger", () => {
    const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    expect(wrangler).toContain(`"crons": ["${GC_CRON}"]`);
  });
});

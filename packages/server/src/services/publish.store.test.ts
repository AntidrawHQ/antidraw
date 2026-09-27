import { describe, expect, it } from "vitest";
import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { createD1Shim, hasNodeSqlite, insertUser, type D1Shim } from "../test/d1-sqlite";
import { hex } from "../test/publish-harness";
import {
  chunk,
  d1PublishStore,
  PLAN_STUB,
  type NewSession,
  type NewVersion,
  type PublishStore,
} from "./publish.store";

// The store's SQL against real SQLite (node:sqlite), with D1's limits
// enforced by the shim. Real D1 is covered by the local end-to-end recipe.

const U = "user-1";
const V = "user-2";

type Setup = {
  shim: D1Shim;
  store: PublishStore;
  q: <T>(sql: string, ...params: unknown[]) => T[];
};

const setup = (): Setup => {
  const shim = createD1Shim();
  insertUser(shim, U);
  insertUser(shim, V);
  const store = d1PublishStore(getDb({ DB: shim } as unknown as Bindings));
  const q = <T>(sql: string, ...params: unknown[]) =>
    shim.sqlite.prepare(sql).all(...(params as never[])) as T[];
  return { shim, store, q };
};

const site = async (store: PublishStore, id = "site_1", user = U, workspace = "w1") => {
  expect(
    await store.insertSiteIfAbsent({
      id,
      userId: user,
      clientWorkspaceId: workspace,
      name: "Acme",
      slug: `acme-${id}`,
      allowRemix: true,
      now: 1,
    }),
  ).toBe("inserted");
};

const session = (over: Partial<NewSession> = {}): NewSession => ({
  id: "pub_1",
  userId: U,
  siteId: "site_1",
  baseVersion: 0,
  plan: "{}",
  expiresAt: 1000,
  holdUntil: 1000,
  now: 10,
  objects: [
    { kind: "source", sha256: hex("src"), size: 100 },
    { kind: "blob", sha256: hex("blob"), size: 2000 },
  ],
  siteUploadBytes: 0,
  cleanupAfter: 5000,
  ...over,
});

const version = (over: Partial<NewVersion> = {}): NewVersion => ({
  id: "ver_1",
  siteId: "site_1",
  userId: U,
  sessionId: "pub_1",
  baseVersion: 0,
  source: { sha256: hex("src"), size: 100 },
  snapshotBytes: 2100,
  fileCount: 3,
  siteFileCount: 1,
  siteBytes: 10,
  largeFiles: [{ path: "a.bin", sha256: hex("blob"), size: 2000, mode: 420 }],
  liveFiles: '["index.html"]',
  liveEntries: JSON.stringify([{ path: "index.html", sha256: hex("index") }]),
  keepVersions: 5,
  cleanupAfter: 9000,
  now: 20,
  ...over,
});

const lock = (store: PublishStore, sessionId = "pub_1", baseVersion = 0) =>
  store.claimCompleteLock({
    siteId: "site_1",
    sessionId,
    baseVersion,
    now: 15,
    expiresAt: 15 + 600_000,
  });

describe("chunk", () => {
  it("sizes chunks to D1's 100-parameter limit", () => {
    const rows = Array.from({ length: 101 }, (_, i) => i);
    expect(chunk(rows, 5).map((c) => c.length)).toEqual([20, 20, 20, 20, 20, 1]);
    expect(chunk(rows, 6)[0]).toHaveLength(16);
    expect(chunk(rows, 3)[0]).toHaveLength(33);
    expect(chunk(rows, 1, 3)[0]).toHaveLength(97);
    expect(chunk([], 5)).toEqual([]);
  });
});

describe.skipIf(!hasNodeSqlite)("d1PublishStore (node:sqlite)", () => {
  it("the shim enforces D1's limits", async () => {
    const { shim } = setup();
    const params = Array.from({ length: 101 }, (_, i) => i);
    const sql = `SELECT ${params.map(() => "?").join(", ")}`;
    await expect(
      shim
        .prepare(sql)
        .bind(...params)
        .all(),
    ).rejects.toThrow(/100 bound parameters|101/);
    await expect(
      shim
        .prepare(sql.replace(", ?", ""))
        .bind(...params.slice(1))
        .all(),
    ).resolves.toBeTruthy();
    await expect(shim.prepare(`SELECT '${"x".repeat(100_001)}'`).all()).rejects.toThrow(
      /100000 bytes/,
    );
    // Inside a batch too, and the batch rolls back.
    await expect(
      shim.batch([
        shim.prepare(
          "INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('x', 'x', 'x', 0, 0)",
        ),
        shim.prepare(sql).bind(...params),
      ]),
    ).rejects.toThrow();
    expect(shim.sqlite.prepare("SELECT count(*) AS n FROM user WHERE id = 'x'").get()).toEqual({
      n: 0,
    });
  });

  it("the shim refuses a row over D1's 2 000 000 bytes, counting every column", async () => {
    const { shim, store, q } = setup();
    await site(store);
    // Each value alone is fine; together they are not.
    q("UPDATE site SET live_files = ? WHERE id = 'site_1'", "l".repeat(1_200_000));
    expect(() =>
      q("UPDATE site SET protected_files = ? WHERE id = 'site_1'", "p".repeat(1_000_000)),
    ).toThrow(/string or blob too big/);
    await expect(
      shim
        .prepare("UPDATE site SET protected_files = ? WHERE id = 'site_1'")
        .bind("p".repeat(700_000))
        .run(),
    ).resolves.toBeTruthy();
  });

  it("inserts a site once per workspace, and reports a taken slug", async () => {
    const { store } = setup();
    await site(store);
    const again = {
      id: "site_2",
      userId: U,
      clientWorkspaceId: "w1",
      name: "B",
      slug: "acme-other",
      allowRemix: true,
      now: 2,
    };
    expect(await store.insertSiteIfAbsent(again)).toBe("exists");
    expect(
      await store.insertSiteIfAbsent({ ...again, clientWorkspaceId: "w2", slug: "acme-site_1" }),
    ).toBe("slug-taken");
    expect(await store.countSites(U)).toBe(1);
    expect(await store.findSiteBySlug("acme-site_1")).toMatchObject({
      id: "site_1",
      headVersion: 0,
      allowRemix: true,
    });
    expect(
      await store.updateSite("site_1", { allowRemix: false, name: "Renamed" }, 7),
    ).toMatchObject({
      allowRemix: false,
      name: "Renamed",
      updatedAt: 7,
    });
  });

  it("upserts stored objects: unverified rows keep the largest size, verified and deleting rows do not change", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    q("UPDATE stored_object SET verified = 1 WHERE kind = 'source'");
    await store.createSession(
      session({
        id: "pub_2",
        objects: [
          { kind: "source", sha256: hex("src"), size: 999 },
          { kind: "blob", sha256: hex("blob"), size: 5000 },
        ],
      }),
    );
    expect(q("SELECT kind, size FROM stored_object ORDER BY kind")).toEqual([
      { kind: "blob", size: 5000 },
      { kind: "source", size: 100 },
    ]);
    // A smaller size declared later does not shrink it: an upload URL signed
    // for 5000 bytes may still be in use.
    await store.createSession(
      session({ id: "pub_s", objects: [{ kind: "blob", sha256: hex("blob"), size: 10 }] }),
    );
    expect(q("SELECT size FROM stored_object WHERE kind = 'blob'")).toEqual([{ size: 5000 }]);
    q("UPDATE stored_object SET deleting = 1, verified = 0 WHERE kind = 'blob'");
    await store.createSession(
      session({ id: "pub_3", objects: [{ kind: "blob", sha256: hex("blob"), size: 7 }] }),
    );
    expect(q("SELECT size, deleting FROM stored_object WHERE kind = 'blob'")).toEqual([
      { size: 5000, deleting: 1 },
    ]);
    expect(q("SELECT cleanup_after FROM site")).toEqual([{ cleanup_after: 5000 }]);
  });

  it("counts every non-deleting object of the account (usedBytes)", async () => {
    const { store, q } = setup();
    await site(store);
    await site(store, "site_2", V, "w9");
    await store.createSession(session());
    await store.createSession(
      session({
        id: "pub_v",
        userId: V,
        siteId: "site_2",
        objects: [{ kind: "source", sha256: hex("src"), size: 7 }],
      }),
    );
    expect(await store.usedBytes(U)).toBe(2100);
    expect(await store.usedBytes(V)).toBe(7);
    q("UPDATE stored_object SET deleting = 1 WHERE kind = 'blob'");
    expect(await store.usedBytes(U)).toBe(100);
  });

  it("commits a version under the guard, and verifies, clears and retains", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    expect(await lock(store)).not.toBeNull();
    expect(await store.commitVersion(version())).toEqual({ ok: true });
    expect(q("SELECT version, source_sha256, allow_remix FROM site_version")).toEqual([
      { version: 1, source_sha256: hex("src"), allow_remix: 1 },
    ]);
    expect(q("SELECT path FROM version_large_file")).toEqual([{ path: "a.bin" }]);
    expect(q("SELECT verified FROM stored_object")).toEqual([{ verified: 1 }, { verified: 1 }]);
    expect(await store.findSiteById("site_1")).toMatchObject({
      headVersion: 1,
      completeLock: null,
      protectedFiles: null,
      liveFiles: '["index.html"]',
      cleanupAfter: 9000,
    });
    expect(await store.getSession("pub_1")).toMatchObject({
      status: "completed",
      resultVersion: 1,
    });
    expect(await store.getHeadVersion({ id: "site_1", headVersion: 1 })).toMatchObject({
      id: "ver_1",
      version: 1,
    });
  });

  const expectRolledBack = (q: Setup["q"]) => {
    expect(q("SELECT * FROM site_version")).toEqual([]);
    expect(q("SELECT * FROM version_large_file")).toEqual([]);
    expect(q("SELECT verified FROM stored_object")).toEqual([{ verified: 0 }, { verified: 0 }]);
    expect(q("SELECT status FROM publish_session WHERE id = 'pub_1'")).toEqual([
      { status: "pending" },
    ]);
  };

  it("rolls the whole batch back when an object is deleting", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    q("UPDATE stored_object SET deleting = 1 WHERE kind = 'blob'");
    expect(await store.commitVersion(version())).toEqual({
      ok: false,
      reason: "objects-gone",
      missing: [{ kind: "blob", sha256: hex("blob") }],
    });
    expectRolledBack(q);
    expect(await store.findSiteById("site_1")).toMatchObject({
      headVersion: 0,
      completeLock: "pub_1",
    });
  });

  it("rolls back when the lock is not the session's", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store, "pub_other");
    expect(await store.commitVersion(version())).toEqual({ ok: false, reason: "lock-lost" });
    expectRolledBack(q);
  });

  it("rolls back when the head moved", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    q("UPDATE site SET head_version = 3");
    expect(await store.commitVersion(version())).toEqual({ ok: false, reason: "conflict" });
    expectRolledBack(q);
  });

  it("fails on the unique (site_id, version) index even when the guard passes", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    q(
      `INSERT INTO site_version (id, site_id, user_id, version, source_sha256, source_size, snapshot_bytes,
         file_count, site_file_count, site_bytes, publish_session_id, created_at)
       VALUES ('ver_x', 'site_1', ?, 1, 'x', 1, 1, 1, 1, 1, 'pub_x', 0)`,
      U,
    );
    const result = await store.commitVersion(version());
    expect(result).toMatchObject({ ok: false, reason: "other" });
    expect(String((result as { error: Error }).error)).toMatch(
      /UNIQUE constraint failed: site_version/,
    );
    expect(q("SELECT id FROM site_version")).toEqual([{ id: "ver_x" }]);
  });

  it("claims the lock only against the expected head and a free, lapsed or own lock", async () => {
    const { store } = setup();
    await site(store);
    const claim = (over: Partial<Parameters<PublishStore["claimCompleteLock"]>[0]> = {}) =>
      store.claimCompleteLock({
        siteId: "site_1",
        sessionId: "pub_1",
        baseVersion: 0,
        now: 100,
        expiresAt: 700,
        ...over,
      });
    expect(await claim({ baseVersion: 1 })).toBeNull();
    expect(await claim()).toMatchObject({ id: "site_1", completeLock: "pub_1" });
    expect(await claim({ sessionId: "pub_2" })).toBeNull(); // live lock
    // The session's own live lock (a request of it died holding it).
    expect(await claim({ now: 200, expiresAt: 800 })).toMatchObject({
      completeLockExpiresAt: 800,
    });
    expect(await store.checkCompleteLock("site_1", "pub_1", 200, 600)).toBe(true);
    expect(await store.checkCompleteLock("site_1", "pub_1", 200, 601)).toBe(false);
    expect(await claim({ sessionId: "pub_2", now: 801, expiresAt: 1400 })).toMatchObject({
      completeLock: "pub_2",
    }); // lapsed
    await store.releaseCompleteLock("site_1", "pub_1"); // not ours any more: no-op
    expect((await store.findSiteById("site_1"))?.completeLock).toBe("pub_2");
    await store.releaseCompleteLock("site_1", "pub_2");
    expect((await store.findSiteById("site_1"))?.completeLock).toBeNull();
  });

  it("sets protected_files only under the lock, against the seen value and the fence", async () => {
    const { store } = setup();
    await site(store);
    const set = (over: Partial<Parameters<PublishStore["setProtectedFiles"]>[0]> = {}) =>
      store.setProtectedFiles({
        siteId: "site_1",
        lock: "pub_1",
        protectedFiles: '["a"]',
        seenProtected: null,
        ...over,
      });
    expect(await set()).toBe(false); // not locked
    await lock(store);
    expect(await set({ lock: "pub_2" })).toBe(false);
    expect(await set({ seenProtected: '["b"]' })).toBe(false);
    expect(await set({ fence: { now: 15, minRemainingMs: 600_001 } })).toBe(false);
    expect(await set({ fence: { now: 15, minRemainingMs: 600_000 } })).toBe(true);
    expect((await store.findSiteById("site_1"))?.protectedFiles).toBe('["a"]');
    expect(await set({ protectedFiles: "*", seenProtected: '["a"]' })).toBe(true);
    expect((await store.findSiteById("site_1"))?.protectedFiles).toBe("*");
  });

  it("chunks a begin of 1 source + 499 blobs and a commit of 1 000 large files", async () => {
    const { shim, store, q } = setup();
    await site(store);
    const objects = [
      { kind: "source" as const, sha256: hex("src"), size: 100 },
      ...Array.from({ length: 499 }, (_, i) => ({
        kind: "blob" as const,
        sha256: hex(i + 1),
        size: 1,
      })),
    ];
    await store.createSession(session({ objects }));
    expect(q("SELECT count(*) AS n FROM stored_object")).toEqual([{ n: 500 }]);
    expect(q("SELECT count(*) AS n FROM publish_session_object")).toEqual([{ n: 500 }]);
    expect((await store.getStoredObjects(U, objects)).length).toBe(500);
    expect(await store.releaseUnheldObjects(U, objects, 0)).toBe(0); // all held by pub_1

    await lock(store);
    const largeFiles = Array.from({ length: 1000 }, (_, i) => ({
      path: `f/${String(i).padStart(4, "0")}.bin`,
      sha256: hex((i % 499) + 1),
      size: 1,
      mode: 420,
    }));
    expect(await store.commitVersion(version({ largeFiles }))).toEqual({ ok: true });
    expect(q("SELECT count(*) AS n FROM version_large_file")).toEqual([{ n: 1000 }]);
    expect(q("SELECT count(*) AS n FROM stored_object WHERE verified = 1")).toEqual([{ n: 500 }]);
    expect(Math.max(...shim.log.map((s) => s.params))).toBeLessThanOrEqual(100);
    expect((await store.getLargeFiles("ver_1")).length).toBe(1000);
  });

  it("claims GC candidates in one UPDATE ... RETURNING", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 1000 }));
    const opts = { now: 500, minCreatedAt: 0, limit: 500 };
    expect(await store.claimGcObjects(opts)).toEqual([]); // held
    expect(await store.claimGcObjects({ ...opts, now: 1000 })).toEqual(
      expect.arrayContaining([
        { userId: U, kind: "source", sha256: hex("src") },
        { userId: U, kind: "blob", sha256: hex("blob") },
      ]),
    );
    expect(q("SELECT deleting, verified FROM stored_object")).toEqual([
      { deleting: 1, verified: 0 },
      { deleting: 1, verified: 0 },
    ]);
    expect(await store.leftoverDeletingObjects(10)).toHaveLength(2);
    expect(await store.deleteObjectRows([{ userId: U, kind: "source", sha256: hex("src") }])).toBe(
      1,
    );
    expect(q("SELECT kind FROM stored_object")).toEqual([{ kind: "blob" }]);
  });

  it("keeps the age floor for verified objects and skips version references", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 100 }));
    await lock(store);
    await store.commitVersion(version());
    const opts = { now: 5000, limit: 500 };
    expect(await store.claimGcObjects({ ...opts, minCreatedAt: 0 })).toEqual([]); // referenced, and fresh
    q("DELETE FROM site_version");
    expect(await store.claimGcObjects({ ...opts, minCreatedAt: 10 })).toEqual([]); // created_at 10: not older
    expect(await store.claimGcObjects({ ...opts, minCreatedAt: 11 })).toHaveLength(2);
  });

  it("does not claim a row a session started holding just before", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 100 }));
    // The first session's hold has ended; a second begin holds the same objects.
    await store.createSession(session({ id: "pub_2", holdUntil: 9000 }));
    expect(await store.claimGcObjects({ now: 200, minCreatedAt: 0, limit: 500 })).toEqual([]);
  });

  it("releases only unheld, unverified, unreferenced rows", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 0 }));
    q("UPDATE stored_object SET verified = 1 WHERE kind = 'source'");
    const refs = [
      { kind: "source" as const, sha256: hex("src") },
      { kind: "blob" as const, sha256: hex("blob") },
    ];
    expect(await store.releaseUnheldObjects(U, refs, 50)).toBe(1);
    expect(q("SELECT kind FROM stored_object")).toEqual([{ kind: "source" }]);
  });

  it("finishes a site cleanup only against the cleanup_after it saw", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ cleanupAfter: 50 }));
    expect(await store.sitesDueForCleanup(60, 0, 10)).toEqual([
      { id: "site_1", slug: "acme-site_1" },
    ]);
    expect(await store.claimSiteLockForGc("site_1", "gc:1", 60, 360)).toBe(true);
    expect(await store.claimSiteLockForGc("site_1", "gc:2", 60, 360)).toBe(false);
    expect(await store.heldSessionPlans("site_1", 60)).toEqual([{ plan: "{}", holdUntil: 1000 }]);
    await store.finishSiteCleanup("site_1", "gc:1", 40, 777, 60); // a begin moved it on: kept
    expect(await store.findSiteById("site_1")).toMatchObject({
      cleanupAfter: 50,
      cleanupSince: 60,
      completeLock: null,
    });
    await store.finishSiteCleanup("site_1", "gc:1", 50, null, 70);
    expect(await store.findSiteById("site_1")).toMatchObject({
      cleanupAfter: null,
      cleanupSince: null,
    });
  });

  // D1 never runs ANALYZE, so the planner has no statistics to steer it off a
  // low-cardinality index. Every per-account stored_object query must use the
  // primary key, not walk all accounts' rows.
  it("keeps per-account stored_object queries on the primary key", async () => {
    const { shim, store } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 100 }));
    await lock(store);
    const from = shim.log.length;
    await store.usedBytes(U);
    await store.releaseUnheldObjects(U, [{ kind: "blob", sha256: hex("x") }], 50);
    await store.commitVersion(version());
    await store.deleteObjectRows([{ userId: U, kind: "blob", sha256: hex("x") }]);
    const touching = shim.log
      .slice(from)
      .map((s) => s.sql)
      .filter((sql) => /^\s*(select|update|delete)\b[^]*?\bstored_object\b/i.test(sql))
      .filter((sql) => !/^\s*insert/i.test(sql));
    expect(touching.length).toBeGreaterThanOrEqual(4);
    for (const sql of touching) {
      const plan = (
        shim.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]
      ).map((r) => r.detail);
      const onObjects = plan.filter(
        (d) => /\bstored_object\b(?! AS)/.test(d) && !/SCAN CONSTANT/.test(d),
      );
      expect(onObjects.join("\n"), sql).toMatch(/sqlite_autoindex_stored_object_1/);
      expect(plan.join("\n"), sql).not.toMatch(/stored_object_deleting/);
    }
  });

  it("claims GC candidates in turns across accounts, oldest first", async () => {
    const { store, q } = setup();
    await site(store);
    await site(store, "site_2", V, "w2");
    const blobs = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => ({
        kind: "blob" as const,
        sha256: hex(`${tag}${i}`),
        size: 1,
      }));
    await store.createSession(session({ holdUntil: 0, objects: blobs(5, "u"), now: 10 }));
    await store.createSession(
      session({
        id: "pub_2",
        userId: V,
        siteId: "site_2",
        holdUntil: 0,
        objects: blobs(2, "v"),
        now: 20,
      }),
    );
    const claimed = await store.claimGcObjects({ now: 100, minCreatedAt: 0, limit: 3 });
    expect(claimed.map((c) => c.userId).sort()).toEqual([U, U, V]);
    expect(
      q("SELECT count(*) AS n FROM stored_object WHERE deleting = 1 AND user_id = ?", V),
    ).toEqual([{ n: 1 }]);
  });

  it("counts an account's open sessions and their pending site bytes", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ siteUploadBytes: 300 }));
    await store.createSession(session({ id: "pub_2", siteUploadBytes: 50, objects: [] }));
    await store.createSession(
      session({ id: "pub_3", siteUploadBytes: 7, holdUntil: 10, objects: [] }),
    );
    expect(await store.openSessions(U, 500)).toEqual({ count: 2, siteUploadBytes: 350 });
    await store.setSessionStatus("pub_2", "aborted");
    expect(await store.openSessions(U, 500)).toEqual({ count: 2, siteUploadBytes: 350 });
    await lock(store);
    await store.commitVersion(version());
    expect(await store.openSessions(U, 500)).toEqual({ count: 1, siteUploadBytes: 50 });
    expect(await store.openSessions(V, 500)).toEqual({ count: 0, siteUploadBytes: 0 });
  });

  it("commits the head's entries, stubs the plan, and starts cleanup_since", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ plan: JSON.stringify({ big: "x".repeat(1000) }) }));
    expect((await store.findSiteById("site_1"))?.cleanupSince).toBe(10);
    await lock(store);
    await store.commitVersion(version());
    expect((await store.getSession("pub_1"))?.plan).toBe(PLAN_STUB);
    expect(await store.findSiteById("site_1")).toMatchObject({
      liveEntries: JSON.stringify([{ path: "index.html", sha256: hex("index") }]),
      cleanupSince: 10,
    });
    // A committed session's plan is not one GC keeps paths for.
    expect(await store.heldSessionPlans("site_1", 500)).toEqual([{ plan: null, holdUntil: 1000 }]);
  });

  it("lists a site as due once its cleanup has been put off long enough", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ now: 10, cleanupAfter: 5000 }));
    expect(await store.sitesDueForCleanup(100, 5, 10)).toEqual([]);
    expect(await store.sitesDueForCleanup(100, 11, 10)).toEqual([
      { id: "site_1", slug: "acme-site_1" },
    ]);
  });

  it("retires sessions whose hold ended, keeping plans only on a * site", async () => {
    const { store, q } = setup();
    await site(store);
    await site(store, "site_2", U, "w2");
    const plan = JSON.stringify({ paths: ["a.js"] });
    await store.createSession(session({ plan, holdUntil: 100 }));
    await store.createSession(session({ id: "pub_2", siteId: "site_2", plan, holdUntil: 100 }));
    await store.createSession(session({ id: "pub_3", plan, holdUntil: 900 }));
    q("UPDATE site SET protected_files = '*' WHERE id = 'site_2'");
    expect(await store.retireSessions(200, 97)).toBe(2);
    expect(await store.retireSessions(200, 97)).toBe(0);
    expect(await store.getSession("pub_1")).toMatchObject({ holdUntil: 0, plan: PLAN_STUB });
    expect(await store.getSession("pub_2")).toMatchObject({ holdUntil: 0, plan });
    expect(await store.getSession("pub_3")).toMatchObject({ holdUntil: 900, plan });
    expect(q("SELECT DISTINCT session_id FROM publish_session_object ORDER BY session_id")).toEqual(
      [{ session_id: "pub_3" }],
    );
    expect(await store.uncommittedPlansMentioning("site_2", "a.js")).toEqual([plan]);

    // Uncommitted ones on a * site are kept until "*" is resolved.
    const old = { now: 5000, completedBefore: 0, uncommittedBefore: 4000, limit: 10 };
    expect(await store.deleteOldSessions(old)).toBe(2);
    expect(await store.getSession("pub_2")).not.toBeNull();
    q("UPDATE site SET protected_files = NULL WHERE id = 'site_2'");
    expect(await store.deleteOldSessions(old)).toBe(1);
  });

  it("prunes old versions, expires and forgets sessions, and deletes abandoned sites", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ expiresAt: 100, holdUntil: 100 }));
    expect(await store.expireSessions(101)).toBe(1);
    const old = { now: 101, completedBefore: 11, uncommittedBefore: 101, limit: 10 };
    expect(await store.deleteOldSessions({ ...old, uncommittedBefore: 100 })).toBe(0);
    expect(await store.deleteOldSessions(old)).toBe(1);
    expect(q("SELECT count(*) AS n FROM publish_session_object")).toEqual([{ n: 0 }]); // cascade

    q("UPDATE site SET head_version = 9");
    for (let v = 1; v <= 9; v++) {
      q(
        `INSERT INTO site_version (id, site_id, user_id, version, source_sha256, source_size, snapshot_bytes,
           file_count, site_file_count, site_bytes, keep, publish_session_id, created_at)
         VALUES (?, 'site_1', ?, ?, 'x', 1, 1, 1, 1, 1, ?, 'p', 0)`,
        `ver_${v}`,
        U,
        v,
        v === 2 ? 1 : 0,
      );
    }
    expect(await store.pruneVersions(5)).toBe(3);
    expect(
      q("SELECT version FROM site_version ORDER BY version").map(
        (r) => (r as { version: number }).version,
      ),
    ).toEqual([2, 5, 6, 7, 8, 9]);

    await site(store, "site_2", U, "w2");
    expect((await store.abandonedSites(100, 2, 10)).map((s) => s.id)).toEqual(["site_2"]);
    expect(await store.deleteAbandonedSite("site_2", "gc:1", 100)).toBe(false); // lock not held
    await store.claimSiteLockForGc("site_2", "gc:1", 100, 400);
    expect(await store.deleteAbandonedSite("site_2", "gc:1", 100)).toBe(true);
    expect(await store.findSiteById("site_2")).toBeNull();
  });

  it("cascades a site delete to its sessions, versions and large files", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    await store.commitVersion(version());
    q("DELETE FROM site WHERE id = 'site_1'");
    for (const table of [
      "site_version",
      "version_large_file",
      "publish_session",
      "publish_session_object",
    ]) {
      expect(q(`SELECT count(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }
    // Account objects outlive the site; GC decides their fate.
    expect(q("SELECT count(*) AS n FROM stored_object")).toEqual([{ n: 2 }]);
  });
});

import { describe, expect, it } from "vitest";
import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { createD1Shim, hasNodeSqlite, insertUser, type D1Shim } from "../test/d1-sqlite";
import { hex } from "../test/publish-harness";
import {
  chunk,
  d1PublishStore,
  jsonChunks,
  largeFileRowBytes,
  PLAN_STUB,
  siteFileRowBytes,
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
  budget: { windowMs: 3_600_000, maxObjects: 1_000_000 },
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
  siteFiles: [
    { path: "index.html", sha256: hex("index"), size: 10, contentType: "text/html", immutable: false },
  ],
  fileRowBytes:
    siteFileRowBytes({ path: "index.html", contentType: "text/html" }) +
    largeFileRowBytes({ path: "a.bin" }),
  keepVersions: 5,
  now: 20,
  sessionObjects: 2, // session()'s
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

  it("packs rows into JSON arrays of at most the byte limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => [`p${i}`, i]);
    expect(jsonChunks(rows)).toEqual([JSON.stringify(rows)]);
    // Each row is 8 bytes plus a comma; 2 for the brackets.
    expect(jsonChunks(rows, 20).map((c) => JSON.parse(c) as unknown[])).toEqual([
      rows.slice(0, 2),
      rows.slice(2, 4),
      rows.slice(4),
    ]);
    // A row larger than the limit still goes, alone.
    expect(jsonChunks([["x".repeat(50)]], 20)).toHaveLength(1);
    expect(jsonChunks([])).toEqual([]);
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

  it("the shim refuses a row or a bound value over D1's 2 000 000 bytes", async () => {
    const { shim, store, q } = setup();
    await site(store);
    // Each value alone is fine; together they are not.
    q("UPDATE site SET name = ? WHERE id = 'site_1'", "l".repeat(1_200_000));
    expect(() =>
      q("UPDATE site SET client_workspace_id = ? WHERE id = 'site_1'", "p".repeat(1_000_000)),
    ).toThrow(/string or blob too big/);
    await expect(
      shim
        .prepare("UPDATE site SET client_workspace_id = ? WHERE id = 'site_1'")
        .bind("p".repeat(700_000))
        .run(),
    ).resolves.toBeTruthy();
    await expect(
      shim.prepare("SELECT length(?) AS n").bind("x".repeat(2_000_001)).all(),
    ).rejects.toThrow(/string or blob too big/);
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
  });

  it("counts every non-deleting source and blob of the account (usedBytes), no site content", async () => {
    const { store, q } = setup();
    await site(store);
    await site(store, "site_2", V, "w9");
    await store.createSession(
      session({
        objects: [...session().objects, { kind: "site", sha256: hex("index"), size: 99_999 }],
      }),
    );
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
    // Another session holding the same objects keeps its rows.
    await store.createSession(session({ id: "pub_2" }));
    expect(await lock(store)).not.toBeNull();
    expect(await store.commitVersion(version())).toEqual({ ok: true });
    expect(q("SELECT version, source_sha256, allow_remix FROM site_version")).toEqual([
      { version: 1, source_sha256: hex("src"), allow_remix: 1 },
    ]);
    expect(q("SELECT path FROM version_large_file")).toEqual([{ path: "a.bin" }]);
    expect(q("SELECT user_id, path, sha256, size, content_type FROM version_site_file")).toEqual([
      { user_id: U, path: "index.html", sha256: hex("index"), size: 10, content_type: "text/html" },
    ]);
    // The age floor restarts at the commit (created at 10, committed at 20).
    expect(q("SELECT verified, created_at FROM stored_object")).toEqual([
      { verified: 1, created_at: 20 },
      { verified: 1, created_at: 20 },
    ]);
    expect(await store.findSiteById("site_1")).toMatchObject({
      headVersion: 1,
      pointerVersion: 0,
      completeLock: null,
    });
    // Retired by its commit: it holds nothing and keeps no session objects.
    expect(await store.getSession("pub_1")).toMatchObject({
      status: "completed",
      resultVersion: 1,
      holdUntil: 0,
      plan: PLAN_STUB,
    });
    expect(q("SELECT session_id, count(*) AS n FROM publish_session_object GROUP BY 1")).toEqual([
      { session_id: "pub_2", n: 2 },
    ]);
    expect(await store.getHeadVersion({ id: "site_1", headVersion: 1 })).toMatchObject({
      id: "ver_1",
      version: 1,
    });
  });

  const expectRolledBack = (q: Setup["q"]) => {
    expect(q("SELECT * FROM site_version")).toEqual([]);
    expect(q("SELECT * FROM version_large_file")).toEqual([]);
    expect(q("SELECT * FROM version_site_file")).toEqual([]);
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
    // The session keeps its session objects, and its hold.
    expect(q("SELECT count(*) AS n FROM publish_session_object")).toEqual([{ n: 2 }]);
    expect(await store.getSession("pub_1")).toMatchObject({ holdUntil: 1000 });
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

  // A complete that straddles a GC run: GC claims the session's unverified
  // objects once its hold ends, deletes them and then retires the session,
  // deleting its session objects, so the object check has nothing to check.
  const gcRun = async (store: PublishStore, now: number) => {
    await store.expireSessions(now, 97);
    const claimed = await store.claimGcObjects({ now, minCreatedAt: now - 86_400_000, limit: 500 });
    await store.deleteObjectRows(claimed, now);
    await store.retireSessions(now, 97, 10_000);
    return claimed;
  };
  const expired = { ok: false, reason: "expired" };

  it("rolls back when GC retired the session after the lock was taken", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    expect(await lock(store)).not.toBeNull();
    expect(await gcRun(store, 2000)).toHaveLength(2);
    expect(q("SELECT * FROM publish_session_object")).toEqual([]);
    for (const now of [995, 2001]) {
      expect(await store.commitVersion(version({ now }))).toEqual(expired);
    }
    expect(q("SELECT * FROM site_version")).toEqual([]);
    expect(q("SELECT * FROM version_large_file")).toEqual([]);
    expect(q("SELECT status FROM publish_session")).toEqual([{ status: "expired" }]);
    expect(await store.findSiteById("site_1")).toMatchObject({
      headVersion: 0,
      completeLock: "pub_1",
    });
  });

  it("rolls back when the session was aborted, held or not", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    // Aborted with its hold kept: its objects are safe, but it may not commit.
    await store.setSessionStatus("pub_1", "aborted", { onlyIfPending: true });
    expect(await store.commitVersion(version())).toEqual(expired);
    expect(q("SELECT verified FROM stored_object")).toEqual([{ verified: 0 }, { verified: 0 }]);
    // Aborted before any URL was issued: the hold ends at once, and GC may
    // retire it before the in-flight complete commits.
    await store.setSessionStatus("pub_1", "aborted", { holdUntil: 16 });
    expect(await gcRun(store, 17)).toHaveLength(2);
    expect(await store.commitVersion(version())).toEqual(expired);
    expect(q("SELECT * FROM site_version")).toEqual([]);
    expect(q("SELECT status FROM publish_session")).toEqual([{ status: "aborted" }]);
  });

  it("rolls back when the session's hold ended at the commit's now", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 20 }));
    await lock(store);
    expect(await store.commitVersion(version({ now: 20 }))).toEqual(expired);
    expectRolledBack(q);
    expect(await store.commitVersion(version({ now: 19 }))).toEqual({ ok: true });
  });

  it("rolls back when a session object is gone, even while the hold looks live", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    // What GC's retire does, seen by a commit whose clock runs behind GC's.
    q("DELETE FROM publish_session_object WHERE session_id = 'pub_1' AND kind = 'blob'");
    expect(await store.commitVersion(version())).toEqual(expired);
    expectRolledBack(q);
    q("DELETE FROM publish_session_object WHERE session_id = 'pub_1'");
    expect(await store.commitVersion(version())).toEqual(expired);
    expectRolledBack(q);
  });

  it("discards a session with its session objects, leaving the objects and the site", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ plan: JSON.stringify({ big: "x".repeat(10_000) }) }));
    await store.createSession(session({ id: "pub_2", objects: [] }));
    await store.discardSession("pub_1");
    expect(await store.getSession("pub_1")).toBeNull();
    expect(q("SELECT id FROM publish_session")).toEqual([{ id: "pub_2" }]);
    expect(q("SELECT * FROM publish_session_object")).toEqual([]);
    expect(q("SELECT count(*) AS n FROM stored_object")).toEqual([{ n: 2 }]);
    expect(await store.findSiteById("site_1")).not.toBeNull();
    // Nothing holds its objects any more.
    expect(await store.releaseUnheldObjects(U, session().objects, 20)).toBe(2);
  });

  it("retires the session with the status when asked, even while the session holds the lock", async () => {
    const { store, q } = setup();
    await site(store);
    const plan = JSON.stringify({ big: "x".repeat(1000) });
    for (const id of ["pub_1", "pub_2", "pub_3"]) await store.createSession(session({ id, plan }));
    const objects = () =>
      q<{ session_id: string }>("SELECT DISTINCT session_id FROM publish_session_object").map(
        (r) => r.session_id,
      );
    const abort = (id: string) =>
      store.setSessionStatus(id, "aborted", { onlyIfPending: true, holdUntil: 50, retire: true });
    expect(await abort("pub_1")).toBe(true);
    expect(await store.getSession("pub_1")).toMatchObject({
      status: "aborted",
      holdUntil: 50,
      plan: PLAN_STUB,
    });
    expect(objects()).toEqual(["pub_2", "pub_3"]);
    expect(await abort("pub_1")).toBe(false); // no longer pending
    expect(await store.setSessionStatus("pub_2", "aborted")).toBe(true);
    expect((await store.getSession("pub_2"))?.plan).toBe(plan);
    expect(objects()).toEqual(["pub_2", "pub_3"]);
    // A complete in flight read the plan before it took the lock.
    await lock(store, "pub_3");
    await abort("pub_3");
    expect((await store.getSession("pub_3"))?.plan).toBe(PLAN_STUB);
    expect(objects()).toEqual(["pub_2"]);
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
    expect(await claim({ sessionId: "pub_2", now: 801, expiresAt: 1400 })).toMatchObject({
      completeLock: "pub_2",
    }); // lapsed
    await store.releaseCompleteLock("site_1", "pub_1"); // not ours any more: no-op
    expect((await store.findSiteById("site_1"))?.completeLock).toBe("pub_2");
    await store.releaseCompleteLock("site_1", "pub_2");
    expect((await store.findSiteById("site_1"))?.completeLock).toBeNull();
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
    expect(await store.commitVersion(version({ largeFiles, sessionObjects: 500 }))).toEqual({
      ok: true,
    });
    expect(q("SELECT count(*) AS n FROM version_large_file")).toEqual([{ n: 1000 }]);
    expect(q("SELECT count(*) AS n FROM stored_object WHERE verified = 1")).toEqual([{ n: 500 }]);
    expect(Math.max(...shim.log.map((s) => s.params))).toBeLessThanOrEqual(100);
    expect((await store.getLargeFiles("ver_1")).length).toBe(1000);
  });

  it("binds a site's worth of contents and files as JSON, in a few statements", async () => {
    const { shim, store, q } = setup();
    await site(store);
    // Long paths: the site files take more than one JSON chunk.
    const files = Array.from({ length: 5000 }, (_, i) => ({
      path: `assets/${"d/".repeat(100)}${String(i).padStart(4, "0")}-AbC12345.js`,
      sha256: hex(`c${i % 4000}`),
      size: 1 + (i % 4000),
      contentType: "text/javascript",
      immutable: true,
    }));
    const objects = [
      { kind: "source" as const, sha256: hex("src"), size: 100 },
      ...Array.from({ length: 4000 }, (_, i) => ({
        kind: "site" as const,
        sha256: hex(`c${i}`),
        size: 1 + i,
      })),
    ];
    const from = shim.log.length;
    await store.createSession(session({ objects }));
    expect(shim.log.length - from).toBeLessThanOrEqual(5);
    expect(q("SELECT count(*) AS n FROM stored_object WHERE kind = 'site'")).toEqual([{ n: 4000 }]);
    expect(q("SELECT count(*) AS n FROM publish_session_object")).toEqual([{ n: 4001 }]);
    expect(q("SELECT size FROM stored_object WHERE sha256 = ?", hex("c9"))).toEqual([{ size: 10 }]);
    expect((await store.getStoredObjects(U, objects)).length).toBe(4001);

    await lock(store);
    const before = shim.log.length;
    const committed = await store.commitVersion(
      version({ largeFiles: [], siteFiles: files, sessionObjects: 4001 }),
    );
    expect(committed).toEqual({ ok: true });
    expect(shim.log.length - before).toBeLessThanOrEqual(10);
    expect(q("SELECT count(*) AS n FROM version_site_file WHERE immutable = 1")).toEqual([
      { n: 5000 },
    ]);
    expect(q("SELECT count(*) AS n FROM stored_object WHERE verified = 1")).toEqual([{ n: 4001 }]);
    expect(Math.max(...shim.log.map((s) => s.params))).toBeLessThanOrEqual(100);
    expect(await store.releaseUnheldObjects(U, objects, 0)).toBe(0); // verified
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
    expect(
      await store.deleteObjectRows([{ userId: U, kind: "source", sha256: hex("src") }], 1000),
    ).toBe(1);
    expect(q("SELECT kind FROM stored_object")).toEqual([{ kind: "blob" }]);
  });

  it("claims a site content once no retained version lists it", async () => {
    const { store, q } = setup();
    await site(store);
    const content = { kind: "site" as const, sha256: hex("index"), size: 10 };
    await store.createSession(
      session({ holdUntil: 100, objects: [...session().objects, content] }),
    );
    await lock(store);
    expect(await store.commitVersion(version({ sessionObjects: 3 }))).toEqual({ ok: true });
    const opts = { now: 5000, minCreatedAt: 21, limit: 500 };
    expect(await store.claimGcObjects(opts)).toEqual([]);
    // Another version lists the same content: still referenced.
    q("DELETE FROM version_large_file");
    q("UPDATE site_version SET source_sha256 = 'gone'");
    expect(await store.claimGcObjects(opts)).toHaveLength(2); // source and blob
    q("DELETE FROM site_version");
    expect(await store.claimGcObjects(opts)).toEqual([
      { userId: U, kind: "site", sha256: hex("index") },
    ]);
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
    // Created at 10, committed at 20: the floor runs from the commit, past
    // every upload URL the session was given.
    expect(await store.claimGcObjects({ ...opts, minCreatedAt: 20 })).toEqual([]);
    expect(await store.claimGcObjects({ ...opts, minCreatedAt: 21 })).toHaveLength(2);
  });

  it("does not claim a row a session started holding just before", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 100 }));
    // The first session's hold has ended; a second begin holds the same objects.
    await store.createSession(session({ id: "pub_2", holdUntil: 9000 }));
    expect(await store.claimGcObjects({ now: 200, minCreatedAt: 0, limit: 500 })).toEqual([]);
  });

  it("keeps a row GC is deleting while a session that began since holds it", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 100 }));
    const claimed = await store.claimGcObjects({ now: 200, minCreatedAt: 0, limit: 500 });
    expect(claimed).toHaveLength(2);
    // A begin while GC deletes the keys: its upsert leaves the deleting rows
    // alone, but it holds them and was given URLs for them (a larger source).
    await store.createSession(
      session({
        id: "pub_2",
        holdUntil: 9000,
        objects: [
          { kind: "source", sha256: hex("src"), size: 150 },
          { kind: "blob", sha256: hex("blob"), size: 2000 },
        ],
      }),
    );
    // GC deleted the keys; the rows stay, tracked again, at the holder's size.
    expect(await store.deleteObjectRows(claimed, 200)).toBe(0);
    expect(q("SELECT kind, size, verified, deleting FROM stored_object ORDER BY kind")).toEqual([
      { kind: "blob", size: 2000, verified: 0, deleting: 0 },
      { kind: "source", size: 150, verified: 0, deleting: 0 },
    ]);
    expect(await store.usedBytes(U)).toBe(2150);
    // Once that hold ends too, GC claims them again and they go.
    const again = await store.claimGcObjects({ now: 9000, minCreatedAt: 0, limit: 500 });
    expect(again).toHaveLength(2);
    expect(await store.deleteObjectRows(again, 9000)).toBe(2);
    expect(q("SELECT kind FROM stored_object")).toEqual([]);
  });

  it("charges begins' session objects to the account's window, and refuses one past it whole", async () => {
    const { store, q } = setup();
    await site(store);
    const budget = { windowMs: 1000, maxObjects: 3 };
    expect(await store.createSession(session({ budget }))).toBe("created");
    expect(await store.sessionObjectsInWindow(U, 10, 1000)).toEqual({ used: 2, resetsAt: 1010 });
    // Two more would take the window to 4: nothing of it is written.
    const over = session({
      id: "pub_2",
      now: 500,
      budget,
      objects: [
        { kind: "source", sha256: hex("src-2"), size: 1 },
        { kind: "blob", sha256: hex("blob-2"), size: 1 },
      ],
    });
    expect(await store.createSession(over)).toBe("over-budget");
    expect(q("SELECT id FROM publish_session")).toEqual([{ id: "pub_1" }]);
    expect(q("SELECT count(*) AS n FROM publish_session_object")).toEqual([{ n: 2 }]);
    expect(q("SELECT count(*) AS n FROM stored_object")).toEqual([{ n: 2 }]);
    expect(q("SELECT window_start, session_objects FROM publish_budget")).toEqual([
      { window_start: 10, session_objects: 2 },
    ]);
    // Another account has its own window.
    await site(store, "site_2", V, "w2");
    expect(
      await store.createSession(session({ id: "pub_3", userId: V, siteId: "site_2", budget })),
    ).toBe("created");
    // Once the window has run, a new one starts with this begin.
    expect(await store.createSession({ ...over, now: 1010 })).toBe("created");
    expect(await store.sessionObjectsInWindow(U, 1010, 1000)).toEqual({
      used: 2,
      resetsAt: 2010,
    });
    expect(await store.sessionObjectsInWindow(U, 2010, 1000)).toEqual({ used: 0, resetsAt: 3010 });
  });

  it("restarts a verified object's age floor at a commit only once it has run an hour", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    expect(await store.commitVersion(version())).toEqual({ ok: true });
    const commitAt = async (n: number, now: number) => {
      const id = `pub_${n}`;
      await store.createSession(session({ id, baseVersion: n - 1, now, holdUntil: now + 1000 }));
      await store.claimCompleteLock({
        siteId: "site_1",
        sessionId: id,
        baseVersion: n - 1,
        now,
        expiresAt: now + 600_000,
      });
      expect(
        await store.commitVersion(
          version({ id: `ver_${n}`, sessionId: id, baseVersion: n - 1, now }),
        ),
      ).toEqual({ ok: true });
      return q<{ created_at: number }>("SELECT DISTINCT created_at FROM stored_object");
    };
    // Committed again within the hour: the rows are left as they are.
    expect(await commitAt(2, 20 + 3_599_999)).toEqual([{ created_at: 20 }]);
    // An hour on, the floor restarts.
    expect(await commitAt(3, 20 + 3_600_001)).toEqual([{ created_at: 20 + 3_600_001 }]);
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

  it("tracks the pointer's version, and lists the sites whose pointer is behind", async () => {
    const { store, q } = setup();
    await site(store);
    await site(store, "site_2", U, "w2");
    expect(await store.sitesBehindPointer(10)).toEqual([]);
    q("UPDATE site SET head_version = 3, updated_at = 5 WHERE id = 'site_1'");
    q("UPDATE site SET head_version = 1, updated_at = 2 WHERE id = 'site_2'");
    expect((await store.sitesBehindPointer(10)).map((s) => s.id)).toEqual(["site_2", "site_1"]);
    expect((await store.sitesBehindPointer(1)).map((s) => s.id)).toEqual(["site_2"]);
    await store.setPointerVersion("site_1", 2);
    expect((await store.findSiteById("site_1"))?.pointerVersion).toBe(2);
    await store.setPointerVersion("site_1", 1); // never lowered
    expect((await store.findSiteById("site_1"))?.pointerVersion).toBe(2);
    await store.setPointerVersion("site_1", 9); // never past the head
    expect((await store.findSiteById("site_1"))?.pointerVersion).toBe(3);
    expect((await store.sitesBehindPointer(10)).map((s) => s.id)).toEqual(["site_2"]);
  });

  it("reads a pointer's files: the head's, and older versions' immutable ones, newest first", async () => {
    const { store, q } = setup();
    await site(store);
    for (let v = 1; v <= 3; v++) {
      q(
        `INSERT INTO site_version (id, site_id, user_id, version, source_sha256, source_size, snapshot_bytes,
           file_count, site_file_count, site_bytes, publish_session_id, created_at)
         VALUES (?, 'site_1', ?, ?, 'x', 1, 1, 1, 1, 1, 'p', 0)`,
        `ver_${v}`,
        U,
        v,
      );
      // A public file whose name looks hashed is not immutable.
      for (const [path, immutable] of [
        ["index.html", 0],
        [`assets/a${v}-AbC12345.js`, 1],
        [`_antidraw/v${v}.js`, 1],
        [`assets/logo-${v}AbC1234.png`, 0],
      ] as const) {
        q(
          `INSERT INTO version_site_file (version_id, user_id, path, sha256, size, content_type,
             immutable)
           VALUES (?, ?, ?, ?, ?, 'text/plain', ?)`,
          `ver_${v}`,
          U,
          path,
          hex(`${v}${path}`),
          v,
          immutable,
        );
      }
    }
    const rows = await store.pointerFiles("site_1", 3, 2);
    expect(rows.map((r) => `${r.version}:${r.path}`)).toEqual([
      "3:_antidraw/v3.js",
      "3:assets/a3-AbC12345.js",
      "3:assets/logo-3AbC1234.png",
      "3:index.html",
      "2:_antidraw/v2.js",
      "2:assets/a2-AbC12345.js",
    ]);
    expect(rows[3]).toEqual({
      version: 3,
      path: "index.html",
      sha256: hex("3index.html"),
      size: 3,
      contentType: "text/plain",
      immutable: false,
    });
    expect(rows[1]).toMatchObject({ path: "assets/a3-AbC12345.js", immutable: true });
  });

  it("prunes the rows no pointer can use from versions the pointer moved past, and their bytes", async () => {
    const { store, q } = setup();
    await site(store);
    // The last two are immutable; a public file under assets/ is not.
    const paths = ["index.html", "assets/logo-AbC12345.png", "assets/a-AbC12345.js", "_antidraw/v.js"];
    const bytes = (ps: string[]) =>
      ps.reduce((a, path) => a + siteFileRowBytes({ path, contentType: "text/plain" }), 0);
    for (let v = 1; v <= 3; v++) {
      q(
        `INSERT INTO site_version (id, site_id, user_id, version, source_sha256, source_size,
           snapshot_bytes, file_count, site_file_count, site_bytes, file_row_bytes,
           publish_session_id, created_at)
         VALUES (?, 'site_1', ?, ?, 'x', 1, 1, 1, 4, 4, ?, 'p', 0)`,
        `ver_${v}`,
        U,
        v,
        bytes(paths),
      );
      for (const path of paths) {
        q(
          `INSERT INTO version_site_file (version_id, user_id, path, sha256, size, content_type,
             immutable)
           VALUES (?, ?, ?, ?, 1, 'text/plain', ?)`,
          `ver_${v}`,
          U,
          path,
          hex(`${v}${path}`),
          paths.indexOf(path) >= 2 ? 1 : 0,
        );
      }
    }
    q("UPDATE site SET head_version = 3 WHERE id = 'site_1'");
    const rows = () =>
      q<{ version: number; n: number; bytes: number }>(
        `SELECT v.version, count(f.path) AS n, v.file_row_bytes AS bytes FROM site_version v
          LEFT JOIN version_site_file f ON f.version_id = v.id GROUP BY v.id ORDER BY v.version`,
      ).map((r) => [r.version, r.n, r.bytes]);

    await store.setPointerVersion("site_1", 1); // at version 1: nothing moved past
    expect(rows()).toEqual([1, 2, 3].map((v) => [v, 4, bytes(paths)]));
    await store.setPointerVersion("site_1", 3);
    const grace = bytes(paths.slice(2));
    expect(rows()).toEqual([
      [1, 2, grace],
      [2, 2, grace],
      [3, 4, bytes(paths)],
    ]);
    expect(await store.fileRowBytes(U)).toBe(2 * grace + bytes(paths));
    expect(await store.fileRowBytes(V)).toBe(0);
    await store.setPointerVersion("site_1", 3); // nothing more to prune
    expect(rows()[0]).toEqual([1, 2, grace]);
    expect(await store.fileRowBytes(U)).toBe(2 * grace + bytes(paths));
  });

  it("records and reads the session objects a complete found", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session());
    expect(await store.presentSessionObjects("pub_1")).toEqual([]);
    await store.markSessionObjectsPresent("pub_1", [
      { kind: "blob", sha256: hex("blob") },
      { kind: "site", sha256: hex("blob") }, // not the session's
    ]);
    expect(await store.presentSessionObjects("pub_1")).toEqual([
      { kind: "blob", sha256: hex("blob") },
    ]);
  });

  it("claims a site's lock for GC only when it is free or lapsed", async () => {
    const { store } = setup();
    await site(store);
    expect(await store.claimSiteLockForGc("site_1", "gc:1", 60, 360)).toBe(true);
    expect(await store.claimSiteLockForGc("site_1", "gc:2", 60, 360)).toBe(false);
    expect(await store.claimSiteLockForGc("site_1", "gc:2", 361, 700)).toBe(true);
  });

  it("never claims GC's lock on a site that has committed", async () => {
    const { store, q } = setup();
    await site(store);
    q("UPDATE site SET head_version = 1");
    expect(await store.claimSiteLockForGc("site_1", "gc:1", 60, 360)).toBe(false);
    expect((await store.findSiteById("site_1"))?.completeLock).toBeNull();
  });

  it("retires sessions a bounded number of session objects at a time, whole sessions first", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ holdUntil: 100 }));
    await store.createSession(session({ id: "pub_2", holdUntil: 90 }));
    // pub_2's hold ended first: its two objects go, and it is retired.
    expect(await store.retireSessions(200, 97, 3)).toEqual({ sessions: 1, objects: 3 });
    expect(await store.getSession("pub_2")).toMatchObject({ holdUntil: 0, plan: PLAN_STUB });
    // pub_1 lost one of its two, so it cannot commit; not retired yet.
    expect(await store.getSession("pub_1")).toMatchObject({ holdUntil: 100 });
    expect(q("SELECT count(*) AS n FROM publish_session_object")).toEqual([{ n: 1 }]);
    expect(await store.retireSessions(200, 97, 3)).toEqual({ sessions: 1, objects: 1 });
    expect(await store.retireSessions(200, 97, 3)).toEqual({ sessions: 0, objects: 0 });
  });

  it("counts every row the account keeps in accountRows", async () => {
    const { store } = setup();
    await site(store);
    await site(store, "site_2", U, "w2");
    const plan = JSON.stringify({ reservedRowBytes: 1234 });
    await store.createSession(session({ plan }));
    expect(await store.accountRows(U)).toEqual({
      objects: 2,
      sessionObjects: 2,
      sessions: 1,
      planBytes: plan.length,
      reservedRowBytes: 1234,
      versions: 0,
      fileRowBytes: 0,
      sites: 2,
    });
    await lock(store);
    expect(await store.commitVersion(version())).toEqual({ ok: true });
    expect(await store.accountRows(U)).toEqual({
      objects: 2,
      sessionObjects: 0,
      sessions: 1,
      planBytes: PLAN_STUB.length,
      reservedRowBytes: 0,
      versions: 1,
      fileRowBytes: version().fileRowBytes,
      sites: 2,
    });
    expect((await store.accountRows(V)).objects).toBe(0);
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
    await store.storedSiteBytes(U);
    await store.getStoredObjects(U, [{ kind: "blob", sha256: hex("x") }]);
    await store.releaseUnheldObjects(U, [{ kind: "blob", sha256: hex("x") }], 50);
    await store.commitVersion(version());
    await store.deleteObjectRows([{ userId: U, kind: "blob", sha256: hex("x") }], 50);
    const touching = shim.log
      .slice(from)
      .map((s) => s.sql)
      .filter((sql) => /^\s*(select|update|delete)\b[^]*?\bstored_object\b/i.test(sql))
      .filter((sql) => !/^\s*insert/i.test(sql));
    expect(touching.length).toBeGreaterThanOrEqual(6);
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

  it("stubs the plan at commit", async () => {
    const { store } = setup();
    await site(store);
    await store.createSession(session({ plan: JSON.stringify({ big: "x".repeat(1000) }) }));
    await lock(store);
    expect(await store.commitVersion(version())).toEqual({ ok: true });
    expect((await store.getSession("pub_1"))?.plan).toBe(PLAN_STUB);
  });

  it("retires sessions whose hold ended, stubbing their plans, and forgets old ones", async () => {
    const { store, q } = setup();
    await site(store);
    const plan = JSON.stringify({ big: "x".repeat(100) });
    await store.createSession(session({ plan, holdUntil: 100 }));
    await store.createSession(session({ id: "pub_2", plan, holdUntil: 100 }));
    await store.createSession(session({ id: "pub_3", plan, holdUntil: 900 }));
    expect(await store.retireSessions(200, 97, 10_000)).toEqual({ sessions: 2, objects: 4 });
    expect(await store.retireSessions(200, 97, 10_000)).toEqual({ sessions: 0, objects: 0 });
    expect(await store.getSession("pub_1")).toMatchObject({ holdUntil: 0, plan: PLAN_STUB });
    expect(await store.getSession("pub_2")).toMatchObject({ holdUntil: 0, plan: PLAN_STUB });
    expect(await store.getSession("pub_3")).toMatchObject({ holdUntil: 900, plan });
    expect(q("SELECT DISTINCT session_id FROM publish_session_object ORDER BY session_id")).toEqual(
      [{ session_id: "pub_3" }],
    );
    const old = { now: 5000, completedBefore: 0, uncommittedBefore: 4000, limit: 10 };
    // pub_3's hold has ended too, but it is not retired yet: its session
    // objects would go with it in a cascade no statement bounds.
    expect(await store.deleteOldSessions(old)).toBe(2);
    expect(await store.retireSessions(5000, 97, 10_000)).toEqual({ sessions: 1, objects: 2 });
    expect(await store.deleteOldSessions(old)).toBe(1);
  });

  it("prunes old versions, expires and forgets sessions, and deletes abandoned sites", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session({ expiresAt: 100, holdUntil: 100 }));
    expect(await store.expireSessions(101, 10)).toBe(1);
    const old = { now: 101, completedBefore: 11, uncommittedBefore: 101, limit: 10 };
    // Not before its session objects are gone: the delete would cascade to them.
    expect(await store.deleteOldSessions(old)).toBe(0);
    expect(await store.retireSessions(101, 10, 10)).toEqual({ sessions: 1, objects: 2 });
    expect(await store.deleteOldSessions({ ...old, uncommittedBefore: 100 })).toBe(0);
    expect(await store.deleteOldSessions(old)).toBe(1);

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
    expect(await store.pruneVersions(5, 2)).toBe(2);
    expect(await store.pruneVersions(5, 2)).toBe(1);
    expect(
      q("SELECT version FROM site_version ORDER BY version").map(
        (r) => (r as { version: number }).version,
      ),
    ).toEqual([2, 5, 6, 7, 8, 9]);
    expect(q("SELECT count(*) AS n FROM version_site_file")).toEqual([{ n: 0 }]);

    await site(store, "site_2", U, "w2");
    expect((await store.abandonedSites(2, 10)).map((s) => s.id)).toEqual(["site_2"]);
    expect(await store.deleteAbandonedSite("site_2", "gc:1")).toBe(false); // lock not held
    await store.claimSiteLockForGc("site_2", "gc:1", 100, 400);
    expect(await store.deleteAbandonedSite("site_2", "gc:1")).toBe(true);
    expect(await store.findSiteById("site_2")).toBeNull();
  });

  it("cascades a site delete to its sessions, versions, large files and site files", async () => {
    const { store, q } = setup();
    await site(store);
    await store.createSession(session());
    await lock(store);
    await store.commitVersion(version());
    q("DELETE FROM site WHERE id = 'site_1'");
    for (const table of [
      "site_version",
      "version_large_file",
      "version_site_file",
      "publish_session",
      "publish_session_object",
    ]) {
      expect(q(`SELECT count(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }
    // Account objects outlive the site; GC decides their fate.
    expect(q("SELECT count(*) AS n FROM stored_object")).toEqual([{ n: 2 }]);
  });
});

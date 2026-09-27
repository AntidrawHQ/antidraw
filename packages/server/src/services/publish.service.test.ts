import { describe, expect, it } from "vitest";
import { env as stubEnv } from "cloudflare:workers";
import {
  GC_CLOCK_SKEW_MARGIN_MS,
  MAX_OPEN_SESSIONS_PER_ACCOUNT,
  MAX_PENDING_SITE_BYTES,
  MAX_PLAN_JSON_BYTES,
  MAX_SITE_FILE_ROW_BYTES,
  MAX_SITES_PER_ACCOUNT,
  MAX_STORED_SITE_BYTES,
  QUOTA_BYTES,
  SESSION_TTL_MS,
} from "../lib/publish-limits";
import { beginPublishRequest, completePublishRequest } from "../lib/publish.schemas";
import { blobKey, pointerKey, siteContentKey, sourceKey } from "../lib/storage";
import { sha256Hex } from "../test/memory-object-store";
import {
  beginRequest,
  defaultEntries,
  entryFiles,
  harnesses,
  hex,
  makeTestDeps,
  MiB,
  performUploads,
  pointerOf,
  recordHeads,
  workspaceId,
  WORKSPACE,
  type PlanInput,
  type TestDeps,
} from "../test/publish-harness";
import { runGc } from "./gc.service";
import {
  abortPublish,
  beginPublish,
  completePublish,
  getPublishSession,
  getSiteStatus,
  makePublishDeps,
  setAllowRemix,
} from "./publish.service";
import { PLAN_STUB, siteFileRowBytes } from "./publish.store";

const USER = "user-1";
const OTHER = "user-2";

const begin = async (deps: TestDeps, input: PlanInput = {}, user = USER) =>
  beginPublish(deps, user, await beginRequest(input));

// begin -> every upload -> complete.
const publish = async (deps: TestDeps, input: PlanInput = {}, user = USER) => {
  const begun = (await begin(deps, input, user))._unsafeUnwrap();
  performUploads(deps, begun.uploads);
  const completed = await completePublish(deps, user, begun.publish.id);
  return { begun, completed: completed._unsafeUnwrap() };
};

const kinds = (uploads: { kind: string }[]) => uploads.map((u) => u.kind).sort();

describe.each(harnesses)("publish service (%s)", (_name, makeHarness) => {
  const setup = () => {
    const harness = makeHarness();
    harness.addUser(USER);
    harness.addUser(OTHER);
    return makeTestDeps(harness);
  };

  describe("begin", () => {
    it("asks for every object of a first publish, and nothing the server has", async () => {
      const deps = setup();
      const { begun, completed } = await publish(deps);
      // The source, the blob, and six site contents (three files, three pages).
      expect(kinds(begun.uploads)).toEqual(["blob", ...Array<string>(6).fill("site"), "source"]);
      expect(begun.publish).toMatchObject({ baseVersion: 0, slug: "acme-canvas-saaab" });
      expect(begun.publish.expiresAt).toBe(new Date(deps.clock.now + SESSION_TTL_MS).toISOString());
      expect(completed.version).toBe(1);

      const again = (await begin(deps))._unsafeUnwrap();
      expect(again.uploads).toEqual([]);
      expect(again.publish).toMatchObject({ baseVersion: 1, siteId: begun.publish.siteId });
    });

    it("signs uploads with the right buckets, keys and types, and no cache control", async () => {
      const deps = setup();
      const { uploads } = (await begin(deps))._unsafeUnwrap();
      const byKind = (kind: string, path?: string) =>
        uploads.find((u) => u.kind === kind && (path === undefined || u.path === path))!;
      expect(byKind("source").url).toBe(
        `https://upload.test/sources/${sourceKey(USER, hex("source-1"))}`,
      );
      expect(byKind("source").headers["content-type"]).toBe("application/gzip");
      expect(byKind("blob").url).toBe(
        `https://upload.test/sources/${blobKey(USER, hex("blob-1"))}`,
      );
      expect(byKind("blob").headers["content-type"]).toBe("application/octet-stream");
      // A site file's content goes to the account's content key, whatever
      // its path: the pointer names its type and caching.
      const hashed = byKind("site", "assets/index-AbC12345.js");
      expect(hashed.url).toBe(
        `https://upload.test/sites/c/${USER}/${hex("site-assets/index-AbC12345.js")}`,
      );
      expect(hashed.headers["content-type"]).toBe("application/octet-stream");
      const index = byKind("site", "index.html");
      expect(index.url).toBe(
        `https://upload.test/sites/${siteContentKey(USER, await sha256Hex(defaultEntries()["index.html"]))}`,
      );
      for (const u of uploads) expect(u.headers["cache-control"]).toBeUndefined();
      expect(byKind("source").path).toBeUndefined();
    });

    it("asks once for a content several paths share, and never for one the account has", async () => {
      const deps = setup();
      const same = { sha256: hex("shared"), size: 42 };
      const first = (
        await begin(deps, {
          files: [
            { path: "a.png", ...same },
            { path: "b/a.png", ...same },
          ],
        })
      )._unsafeUnwrap();
      expect(first.uploads.filter((u) => u.sha256 === same.sha256)).toEqual([
        expect.objectContaining({ kind: "site", path: "a.png", size: 42 }),
      ]);
      performUploads(deps, first.uploads);
      (await completePublish(deps, USER, first.publish.id))._unsafeUnwrap();

      // Another site of the account, with the same contents: nothing to send.
      const other = (
        await begin(deps, {
          workspace: workspaceId(2),
          name: "Other",
          files: [{ path: "img/c.png", ...same }],
        })
      )._unsafeUnwrap();
      expect(other.uploads).toEqual([]);
      expect(deps.sitesBucket.keys(`c/${USER}/`)).toHaveLength(4);
    });

    it("skips unverified objects R2 already has, re-checks them at complete, and verifies them at commit", async () => {
      const deps = setup();
      const first = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, first.uploads);
      (await abortPublish(deps, USER, first.publish.id))._unsafeUnwrap();

      const second = (await begin(deps))._unsafeUnwrap();
      expect(second.uploads).toEqual([]);
      const refs = [
        { kind: "source" as const, sha256: hex("source-1") },
        { kind: "blob" as const, sha256: hex("blob-1") },
      ];
      expect((await deps.store.getStoredObjects(USER, refs)).map((r) => r.verified)).toEqual([
        false,
        false,
      ]);

      // Complete HEADs them again: one vanished meanwhile.
      deps.sourcesBucket.objects.delete(blobKey(USER, hex("blob-1")));
      const incomplete = await completePublish(deps, USER, second.publish.id);
      expect(incomplete._unsafeUnwrapErr()).toMatchObject({
        status: 409,
        code: "UPLOAD_INCOMPLETE",
        details: { missing: [{ kind: "blob", sha256: hex("blob-1") }] },
      });

      const third = (await begin(deps))._unsafeUnwrap();
      expect(kinds(third.uploads)).toEqual(["blob"]);
      performUploads(deps, third.uploads);
      (await completePublish(deps, USER, third.publish.id))._unsafeUnwrap();
      const rows = await deps.store.getStoredObjects(USER, refs);
      expect(rows.every((r) => r.verified)).toBe(true);
    });

    it("refuses when the limiter says so", async () => {
      const deps = setup();
      deps.limits.publish = false;
      expect((await begin(deps))._unsafeUnwrapErr()).toMatchObject({
        status: 429,
        code: "RATE_LIMITED",
      });
    });
  });

  describe("begin validation", () => {
    it("refuses unpublishable site paths with the offending paths", async () => {
      const deps = setup();
      const result = await begin(deps, {
        files: [
          { path: "ok.js" },
          { path: "public/.env" },
          { path: ".hashed-files.json" },
          { path: "a/.b/c" },
        ],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 422,
        code: "INVALID_PATH",
        details: { paths: ["public/.env", ".hashed-files.json", "a/.b/c"] },
      });
    });

    it("refuses a site without its three entry pages", async () => {
      const deps = setup();
      const pages = await entryFiles();
      const result = await begin(deps, {
        entries: null,
        files: [{ path: "logo.png" }, pages.find((f) => f.path === "canvas.json")!],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 400,
        code: "INVALID_REQUEST",
        details: { paths: ["preview.html", "index.html"] },
      });
    });

    it("refuses a site file sha256 declared with two sizes", async () => {
      const deps = setup();
      const result = await begin(deps, {
        files: [
          { path: "a.png", sha256: hex(1), size: 10 },
          { path: "b.png", sha256: hex(1), size: 11 },
        ],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 400,
        code: "INVALID_REQUEST",
        details: { sha256: hex(1) },
      });
    });

    it("refuses duplicate and case-colliding large-file paths", async () => {
      const deps = setup();
      for (const largeFiles of [
        [
          { path: "a.bin", sha256: hex(1), size: 2 * MiB },
          { path: "a.bin", sha256: hex(2), size: 2 * MiB },
        ],
        [
          { path: "Video.mp4", sha256: hex(1), size: 2 * MiB },
          { path: "video.mp4", sha256: hex(2), size: 2 * MiB },
        ],
      ]) {
        expect((await begin(deps, { largeFiles }))._unsafeUnwrapErr()).toMatchObject({
          status: 422,
          code: "INVALID_PATH",
        });
      }
      const dupSite = await begin(deps, { files: [{ path: "x.js" }, { path: "x.js" }] });
      expect(dupSite._unsafeUnwrapErr().code).toBe("INVALID_PATH");
    });

    it("refuses a large-file path the app would never snapshot", async () => {
      const deps = setup();
      const result = await begin(deps, {
        largeFiles: [{ path: ".git/objects/pack/p.pack", sha256: hex(1), size: 2 * MiB }],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 422,
        code: "INVALID_PATH",
        details: { paths: [".git/objects/pack/p.pack"] },
      });
    });

    it("refuses a blob sha256 declared with two sizes", async () => {
      const deps = setup();
      const result = await begin(deps, {
        largeFiles: [
          { path: "a.bin", sha256: hex(1), size: 2 * MiB },
          { path: "b.bin", sha256: hex(1), size: 3 * MiB },
        ],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 400, code: "INVALID_REQUEST" });
    });

    it("refuses a snapshot over 500 MiB counting distinct blobs once", async () => {
      const deps = setup();
      const same = { sha256: hex(7), size: 300 * MiB };
      const deduped = await begin(deps, {
        largeFiles: [
          { path: "a.bin", ...same },
          { path: "b.bin", ...same },
        ],
      });
      expect(deduped.isOk()).toBe(true);

      const result = await begin(deps, {
        source: { sha256: hex("src"), size: 10 * MiB },
        largeFiles: [
          { path: "a.bin", sha256: hex(1), size: 300 * MiB },
          { path: "b.bin", sha256: hex(2), size: 200 * MiB },
        ],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 413,
        code: "PUBLISH_TOO_LARGE",
        details: { limitBytes: 500 * MiB, snapshotBytes: 510 * MiB },
      });
    });

    it("refuses a site over 500 MiB", async () => {
      const deps = setup();
      const result = await begin(deps, {
        files: [
          { path: "a.bin", size: 300 * MiB },
          { path: "b.bin", size: 201 * MiB },
        ],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 413,
        code: "SITE_TOO_LARGE",
        details: { limitBytes: 500 * MiB, siteFileCount: 5 },
      });
    });

    it("refuses a plan too large to store", async () => {
      const deps = setup();
      // Within every per-file limit, but 2 500 long paths add up.
      const segment = "x".repeat(200);
      const files = Array.from({ length: 2500 }, (_, i) => ({
        path: `assets/${i}/${segment}/${segment}/${segment}.js`,
        sha256: hex(i + 1),
      }));
      const result = await begin(deps, { files });
      const error = result._unsafeUnwrapErr();
      expect(error).toMatchObject({ status: 413, code: "PUBLISH_TOO_LARGE" });
      expect(error.details).toMatchObject({ reason: "plan", limitBytes: MAX_PLAN_JSON_BYTES });
      expect((error.details as { planBytes: number }).planBytes).toBeGreaterThan(
        MAX_PLAN_JSON_BYTES,
      );
      expect(await deps.store.findSiteByWorkspace(USER, WORKSPACE)).toBeNull();
    });

    it("leaves fileCount and uncompressedBytes limits to the schema (400)", async () => {
      const base = await beginRequest();
      for (const snapshot of [
        { ...base.snapshot, fileCount: 100_001 },
        { ...base.snapshot, uncompressedBytes: 1000 * MiB + 1 },
      ]) {
        expect(beginPublishRequest.safeParse({ ...base, snapshot }).success).toBe(false);
      }
      expect(beginPublishRequest.safeParse(base).success).toBe(true);
    });
  });

  describe("sites", () => {
    it("creates one site when two begins race for a new workspace", async () => {
      const deps = setup();
      const [a, b] = await Promise.all([begin(deps), begin(deps)]);
      expect(a._unsafeUnwrap().publish.siteId).toBe(b._unsafeUnwrap().publish.siteId);
      expect(await deps.store.countSites(USER)).toBe(1);
    });

    it(`refuses a new site past ${MAX_SITES_PER_ACCOUNT} per account`, async () => {
      const deps = setup();
      for (let i = 0; i < MAX_SITES_PER_ACCOUNT; i++) {
        await publish(deps, { workspace: workspaceId(i) });
      }
      const result = await begin(deps, { workspace: workspaceId(999) });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 403,
        code: "SITE_LIMIT",
        details: { limit: MAX_SITES_PER_ACCOUNT },
      });
      // Existing sites still publish.
      expect((await begin(deps, { workspace: workspaceId(3) })).isOk()).toBe(true);
    });

    it("retries a taken slug, and gives up after five tries", async () => {
      const deps = setup();
      const suffixes = ["aaaaa", "aaaaa", "bbbbb"];
      deps.slugSuffix = () => suffixes.shift() ?? "aaaaa";
      await begin(deps, { workspace: workspaceId(1) });
      const second = (await begin(deps, { workspace: workspaceId(2) }))._unsafeUnwrap();
      expect(second.publish.slug).toBe("acme-canvas-bbbbb");

      const third = await begin(deps, { workspace: workspaceId(3) });
      expect(third._unsafeUnwrapErr()).toMatchObject({
        status: 500,
        code: "SLUG_ALLOCATION_FAILED",
      });
    });

    it("keeps the slug, and updates the name, across publishes", async () => {
      const deps = setup();
      const { begun } = await publish(deps);
      const renamed = (await begin(deps, { name: "Renamed" }))._unsafeUnwrap();
      expect(renamed.publish.slug).toBe(begun.publish.slug);
      expect((await deps.store.findSiteById(begun.publish.siteId))?.name).toBe("Renamed");
    });
  });

  describe("allowRemix", () => {
    it("stores an explicit value at begin and keeps the site's value otherwise", async () => {
      const deps = setup();
      const { begun } = await publish(deps, { allowRemix: false });
      const site = () => deps.store.findSiteById(begun.publish.siteId);
      expect((await site())?.allowRemix).toBe(false);
      await publish(deps);
      expect((await site())?.allowRemix).toBe(false);
      await publish(deps, { allowRemix: true, entries: defaultEntries("v3") });
      expect((await site())?.allowRemix).toBe(true);
    });

    it("defaults a new site to true", async () => {
      const deps = setup();
      const { completed } = await publish(deps);
      expect(completed.site.allowRemix).toBe(true);
    });

    it("keeps a PATCH made during an in-flight publish", async () => {
      const deps = setup();
      const { begun } = await publish(deps);
      const inFlight = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      performUploads(deps, inFlight.uploads);
      const patched = await setAllowRemix(deps, USER, begun.publish.siteId, false);
      expect(patched._unsafeUnwrap().site.allowRemix).toBe(false);
      const done = await completePublish(deps, USER, inFlight.publish.id);
      expect(done._unsafeUnwrap().site.allowRemix).toBe(false);
    });

    it("answers 404 for another user's site", async () => {
      const deps = setup();
      const { begun } = await publish(deps);
      const result = await setAllowRemix(deps, OTHER, begun.publish.siteId, false);
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 404, code: "SITE_NOT_FOUND" });
    });
  });

  describe("quota", () => {
    it("counts every stored object, and refuses past 1 GiB with the numbers", async () => {
      const deps = setup();
      await publish(deps, {
        source: { sha256: hex("s1"), size: 10 * MiB },
        largeFiles: [{ path: "a.bin", sha256: hex("b1"), size: 400 * MiB }],
      });
      // Uploaded, then aborted: still counted (Q10).
      const aborted = (
        await begin(deps, {
          workspace: workspaceId(2),
          source: { sha256: hex("s2"), size: 10 * MiB },
          largeFiles: [{ path: "b.bin", sha256: hex("b2"), size: 450 * MiB }],
        })
      )._unsafeUnwrap();
      performUploads(deps, aborted.uploads);
      (await abortPublish(deps, USER, aborted.publish.id))._unsafeUnwrap();
      expect(await deps.store.usedBytes(USER)).toBe(870 * MiB);

      const refused = await begin(deps, {
        workspace: workspaceId(3),
        source: { sha256: hex("s3"), size: 4 * MiB },
        largeFiles: [{ path: "c.bin", sha256: hex("b3"), size: 200 * MiB }],
      });
      expect(refused._unsafeUnwrapErr()).toMatchObject({
        status: 413,
        code: "QUOTA_EXCEEDED",
        details: { quotaBytes: QUOTA_BYTES, usedBytes: 870 * MiB, publishBytes: 204 * MiB },
      });
      // The refused begin holds and counts nothing.
      expect(await deps.store.usedBytes(USER)).toBe(870 * MiB);
      const fits = await begin(deps, {
        workspace: workspaceId(3),
        source: { sha256: hex("s3"), size: 4 * MiB },
        largeFiles: [{ path: "c.bin", sha256: hex("b3"), size: 150 * MiB }],
      });
      expect(fits.isOk()).toBe(true);
    });

    it("deletes a quota-refused session, holding nothing", async () => {
      const deps = setup();
      (
        await begin(deps, { largeFiles: [{ path: "a.bin", sha256: hex(1), size: 490 * MiB }] })
      )._unsafeUnwrap();
      (
        await begin(deps, {
          workspace: workspaceId(2),
          largeFiles: [{ path: "b.bin", sha256: hex(2), size: 490 * MiB }],
        })
      )._unsafeUnwrap();
      const refused = await begin(deps, {
        workspace: workspaceId(3),
        largeFiles: [{ path: "c.bin", sha256: hex(3), size: 100 * MiB }],
      });
      expect(refused._unsafeUnwrapErr().code).toBe("QUOTA_EXCEEDED");
      expect((await deps.store.openSessions(USER, deps.clock.now)).count).toBe(2);
      expect(await deps.store.getStoredObjects(USER, [{ kind: "blob", sha256: hex(3) }])).toEqual(
        [],
      );
      expect((await deps.harness.sessionRows(USER)).count).toBe(2);
    });

    it("keeps no plan of a refused begin, so refusals cannot fill D1 past the open-session cap", async () => {
      const deps = setup();
      for (const n of [1, 2]) {
        (
          await begin(deps, {
            workspace: workspaceId(n),
            largeFiles: [{ path: "a.bin", sha256: hex(n), size: 490 * MiB }],
          })
        )._unsafeUnwrap();
      }
      const held = await deps.harness.sessionRows(USER);
      const files = Array.from({ length: 200 }, (_, i) => ({
        path: `assets/${"long-directory-name/".repeat(4)}file-${i}.js`,
      }));
      for (let i = 0; i < 30; i++) {
        const refused = await begin(deps, {
          workspace: workspaceId(3),
          largeFiles: [{ path: "c.bin", sha256: hex(1000 + i), size: 100 * MiB }],
          files,
        });
        expect(refused._unsafeUnwrapErr().code).toBe("QUOTA_EXCEEDED");
      }
      expect(await deps.harness.sessionRows(USER)).toEqual(held);
      expect(await deps.store.openSessions(USER, deps.clock.now)).toMatchObject({ count: 2 });
    });

    it("counts the latest declared size of an unverified object (no size forgery)", async () => {
      const deps = setup();
      const small = (
        await begin(deps, { largeFiles: [{ path: "x.bin", sha256: hex("X"), size: 1 * MiB }] })
      )._unsafeUnwrap();
      (await abortPublish(deps, USER, small.publish.id))._unsafeUnwrap();
      (
        await begin(deps, {
          largeFiles: [{ path: "x.bin", sha256: hex("X"), size: 500 * MiB - 1000 }],
        })
      )._unsafeUnwrap();
      expect(await deps.store.usedBytes(USER)).toBe(500 * MiB);
    });

    it("keeps the largest declared size of an unverified object (a smaller redeclaration cannot undercount)", async () => {
      const deps = setup();
      const round = async (n: number) => {
        const big = (
          await begin(deps, {
            workspace: workspaceId(n),
            largeFiles: [{ path: "x.bin", sha256: hex(`X${n}`), size: 490 * MiB }],
          })
        )._unsafeUnwrap();
        performUploads(deps, big.uploads); // the 490 MiB URL is used
        return begin(deps, {
          workspace: workspaceId(n),
          largeFiles: [{ path: "x.bin", sha256: hex(`X${n}`), size: 1 * MiB }],
        });
      };
      expect((await round(1)).isOk()).toBe(true);
      expect(await deps.store.usedBytes(USER)).toBe(490 * MiB + 1000);
      // The second 490 MiB object fits; a third would pass 1 GiB.
      expect((await round(2)).isOk()).toBe(true);
      const third = await begin(deps, {
        workspace: workspaceId(3),
        largeFiles: [{ path: "x.bin", sha256: hex("X3"), size: 490 * MiB }],
      });
      expect(third._unsafeUnwrapErr().code).toBe("QUOTA_EXCEEDED");
    });

    it("refuses a verified object declared with another size", async () => {
      const deps = setup();
      await publish(deps);
      const result = await begin(deps, {
        largeFiles: [{ path: "public/video.mp4", sha256: hex("blob-1"), size: 3 * MiB }],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 400,
        code: "INVALID_REQUEST",
        details: { sha256: hex("blob-1") },
      });
    });
  });

  describe("abort", () => {
    it("keeps the hold of a session that was given upload URLs", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      (await abortPublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      (await abortPublish(deps, USER, begun.publish.id))._unsafeUnwrap(); // idempotent
      const session = await deps.store.getSession(begun.publish.id);
      expect(session).toMatchObject({
        status: "aborted",
        holdUntil: deps.clock.now + SESSION_TTL_MS,
      });

      // GC cannot take its objects while URLs still work.
      await runGc(deps.gc, new Date(deps.clock.now + 60_000));
      expect(
        await deps.store.getStoredObjects(USER, [{ kind: "source", sha256: hex("source-1") }]),
      ).toHaveLength(1);
    });

    it("releases the hold at once when the session had no object URLs (Q9)", async () => {
      const deps = setup();
      await publish(deps);
      const begun = (await begin(deps))._unsafeUnwrap();
      expect(begun.uploads).toEqual([]);
      (await abortPublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      expect(await deps.store.getSession(begun.publish.id)).toMatchObject({
        status: "aborted",
        holdUntil: deps.clock.now,
        // It no longer counts as open, so its plan does not wait for GC.
        plan: PLAN_STUB,
      });
    });

    it("answers 404 for an unknown or foreign session", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      for (const [user, id] of [
        [OTHER, begun.publish.id],
        [USER, "pub_nope"],
      ]) {
        expect((await abortPublish(deps, user, id))._unsafeUnwrapErr()).toMatchObject({
          status: 404,
          code: "PUBLISH_NOT_FOUND",
        });
      }
    });
  });

  describe("complete", () => {
    it("commits the version, then switches the site over with one pointer write", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const slug = begun.publish.slug;
      expect(pointerOf(deps, slug)).toBeNull(); // uploads change nothing visitors see
      const writesBefore = deps.sitesBucket.writes.length;
      const done = (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      expect(deps.sitesBucket.writes.slice(writesBefore)).toEqual([pointerKey(slug)]);
      expect(deps.sitesBucket.objects.get(pointerKey(slug))?.contentType).toBe("application/json");
      const pointer = pointerOf(deps, slug)!;
      expect(pointer).toMatchObject({ v: 1, version: 1, u: USER });
      expect(Object.keys(pointer.files).sort()).toEqual([
        "_antidraw/viewer-AbC12345.js",
        "assets/index-AbC12345.js",
        "canvas.json",
        "index.html",
        "logo.png",
        "preview.html",
      ]);
      const index = defaultEntries()["index.html"];
      expect(pointer.files["index.html"]).toEqual({
        h: await sha256Hex(index),
        s: new TextEncoder().encode(index).length,
        t: "text/html; charset=utf-8",
      });
      expect(pointer.files["logo.png"]).toEqual({
        h: hex("site-logo.png"),
        s: 102,
        t: "image/png",
      });
      expect(done).toMatchObject({
        version: 1,
        site: { slug, headVersion: 1, url: `https://${slug}.antidraw.test`, allowRemix: true },
      });
      expect(done.site.lastPublishedAt).toBe(new Date(deps.clock.now).toISOString());
      expect(await deps.store.findSiteById(begun.publish.siteId)).toMatchObject({
        completeLock: null,
        headVersion: 1,
        pointerVersion: 1,
      });
    });

    it("takes no data: the request body is an empty object", () => {
      expect(completePublishRequest.safeParse({}).success).toBe(true);
    });

    it("refuses with UPLOAD_INCOMPLETE, changing nothing visitors see, when a content is missing or differs", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const slug = first.publish.slug;
      const input = {
        files: [
          { path: "logo.png", sha256: hex("logo-2") },
          { path: "_antidraw/viewer-AbC12345.js", sha256: hex("viewer-2"), size: 101 },
        ],
      };
      const begun = (await begin(deps, input))._unsafeUnwrap();
      expect(begun.uploads.map((u) => u.path).sort()).toEqual([
        "_antidraw/viewer-AbC12345.js",
        "logo.png",
      ]);
      performUploads(
        deps,
        begun.uploads.filter((u) => u.path !== "logo.png"),
      );
      deps.sitesBucket.upload(siteContentKey(USER, hex("viewer-2")), {
        size: 101,
        sha256: hex("wrong"),
      });
      const pointer = deps.sitesBucket.text(pointerKey(slug));
      const result = await completePublish(deps, USER, begun.publish.id);
      const error = result._unsafeUnwrapErr();
      expect(error).toMatchObject({ status: 409, code: "UPLOAD_INCOMPLETE" });
      expect((error.details as { missing: { kind: string; path?: string }[] }).missing).toEqual(
        expect.arrayContaining([
          { kind: "site", sha256: hex("logo-2"), path: "logo.png" },
          { kind: "site", sha256: hex("viewer-2"), path: "_antidraw/viewer-AbC12345.js" },
        ]),
      );
      expect(deps.sitesBucket.text(pointerKey(slug))).toBe(pointer);
      expect(await deps.harness.versionNumbers(first.publish.siteId)).toEqual([1]);
      expect((await deps.store.findSiteById(first.publish.siteId))?.completeLock).toBeNull();

      // Upload the rest and it goes through.
      performUploads(deps, begun.uploads);
      expect((await completePublish(deps, USER, begun.publish.id)).isOk()).toBe(true);
      expect(pointerOf(deps, slug)?.files["logo.png"].h).toBe(hex("logo-2"));
    });

    it("answers STORAGE_FAILED when the switch-over fails, and a retry switches over", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const slug = first.publish.slug;
      const begun = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.sitesBucket.failPut = (key) => key === pointerKey(slug);
      const failed = await completePublish(deps, USER, begun.publish.id);
      expect(failed._unsafeUnwrapErr()).toMatchObject({ status: 500, code: "STORAGE_FAILED" });
      // Committed, not yet live.
      expect((await deps.store.getSession(begun.publish.id))?.status).toBe("completed");
      expect(pointerOf(deps, slug)?.version).toBe(1);
      deps.sitesBucket.failPut = () => false;

      const retried = (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      expect(retried).toMatchObject({ version: 2, site: { headVersion: 2 } });
      expect(pointerOf(deps, slug)?.version).toBe(2);
      expect((await deps.store.findSiteById(first.publish.siteId))?.pointerVersion).toBe(2);
    });

    it("never lets a retry of an older version replace a newer pointer", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const slug = first.publish.slug;
      const second = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      performUploads(deps, second.uploads);
      deps.sitesBucket.failPut = (key) => key === pointerKey(slug);
      await completePublish(deps, USER, second.publish.id);
      deps.sitesBucket.failPut = () => false;
      await publish(deps, { entries: defaultEntries("v3") });
      expect(pointerOf(deps, slug)?.version).toBe(3);

      const writes = deps.sitesBucket.writes.length;
      expect((await completePublish(deps, USER, second.publish.id))._unsafeUnwrap().version).toBe(
        2,
      );
      expect(deps.sitesBucket.writes.length).toBe(writes);
      expect(pointerOf(deps, slug)?.version).toBe(3);
    });

    it("is idempotent once completed", async () => {
      const deps = setup();
      const { begun, completed } = await publish(deps);
      const writes = deps.sitesBucket.writes.length;
      const again = await completePublish(deps, USER, begun.publish.id);
      expect(again._unsafeUnwrap()).toEqual(completed);
      expect(deps.sitesBucket.writes.length).toBe(writes);
    });

    it("refuses an expired or aborted session with 410", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.clock.now += SESSION_TTL_MS + 1;
      expect(
        (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrapErr(),
      ).toMatchObject({
        status: 410,
        code: "PUBLISH_EXPIRED",
      });

      const other = (await begin(deps))._unsafeUnwrap();
      (await abortPublish(deps, USER, other.publish.id))._unsafeUnwrap();
      expect((await completePublish(deps, USER, other.publish.id))._unsafeUnwrapErr().code).toBe(
        "PUBLISH_EXPIRED",
      );
    });

    it("answers 404 for another user's session", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      expect((await completePublish(deps, OTHER, begun.publish.id))._unsafeUnwrapErr().code).toBe(
        "PUBLISH_NOT_FOUND",
      );
    });

    it("lets the first of two sessions on one base win", async () => {
      const deps = setup();
      const a = (await begin(deps))._unsafeUnwrap();
      const b = (await begin(deps, { entries: defaultEntries("b") }))._unsafeUnwrap();
      performUploads(deps, [...a.uploads, ...b.uploads]);
      expect((await completePublish(deps, USER, a.publish.id)).isOk()).toBe(true);
      const lost = await completePublish(deps, USER, b.publish.id);
      expect(lost._unsafeUnwrapErr()).toMatchObject({ status: 409, code: "PUBLISH_CONFLICT" });
      expect(await deps.harness.versionNumbers(a.publish.siteId)).toEqual([1]);
    });

    it("answers PUBLISH_IN_PROGRESS while the site's lock is held", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const now = deps.clock.now;
      expect(
        await deps.store.claimSiteLockForGc(begun.publish.siteId, "gc:x", now, now + 60_000),
      ).toBe(true);
      const busy = await completePublish(deps, USER, begun.publish.id);
      expect(busy._unsafeUnwrapErr()).toMatchObject({ status: 409, code: "PUBLISH_IN_PROGRESS" });
      deps.clock.now += 60_001;
      expect((await completePublish(deps, USER, begun.publish.id)).isOk()).toBe(true);
    });

    it("keeps the 5 newest versions and every keep=1 version", async () => {
      const deps = setup();
      let siteId = "";
      for (let v = 1; v <= 8; v++) {
        const { begun } = await publish(deps, { entries: defaultEntries(`v${v}`) });
        siteId = begun.publish.siteId;
        if (v === 2) await deps.harness.setKeep(siteId, 2);
      }
      expect(await deps.harness.versionNumbers(siteId)).toEqual([2, 4, 5, 6, 7, 8]);
    });

    it("fails the commit when GC claimed an object meanwhile", async () => {
      const deps = setup();
      // An object uploaded by an abandoned session, whose hold then ended.
      const abandoned = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, abandoned.uploads);
      deps.clock.now += SESSION_TTL_MS + 1;
      const claimed = await deps.store.claimGcObjects({
        now: deps.clock.now,
        minCreatedAt: deps.clock.now - 24 * 3600_000,
        limit: 500,
      });
      expect(claimed).toHaveLength(8);

      // A begin while GC is deleting: it must upload again...
      const begun = (await begin(deps))._unsafeUnwrap();
      expect(begun.uploads).toHaveLength(8);
      performUploads(deps, begun.uploads);
      // ...and never commit against the doomed rows.
      const result = await completePublish(deps, USER, begun.publish.id);
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 409, code: "UPLOAD_INCOMPLETE" });
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([]);
      expect(pointerOf(deps, begun.publish.slug)).toBeNull();
    });

    it("HEADs only objects no commit verified, and none at begin that the account never had", async () => {
      const deps = setup();
      await publish(deps);
      const heads = recordHeads(deps);
      const begun = (
        await begin(deps, { files: [{ path: "logo.png", sha256: hex("logo-2") }] })
      )._unsafeUnwrap();
      // A content with no row cannot be in R2: asked for without a HEAD.
      expect(begun.uploads.map((u) => u.path)).toEqual(["logo.png"]);
      expect(heads).toEqual([]);
      performUploads(deps, begun.uploads);
      (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      // The source, the blob and the unchanged contents were verified by the
      // first commit, and only GC deletes a key, after marking its row.
      expect(heads).toEqual([siteContentKey(USER, hex("logo-2"))]);
    });

    it("fails the commit when GC marks a verified object between the checks and the commit", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const begun = (await begin(deps))._unsafeUnwrap();
      expect(begun.uploads).toEqual([]);
      const source = { kind: "source" as const, sha256: hex("source-1") };
      const commit = deps.store.commitVersion;
      deps.store.commitVersion = async (v) => {
        // GC's claim, then its R2 delete, after complete trusted the row.
        await deps.harness.markDeleting(USER, source);
        deps.sourcesBucket.objects.delete(sourceKey(USER, source.sha256));
        return commit(v);
      };
      const result = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 409,
        code: "UPLOAD_INCOMPLETE",
        details: { missing: [source] },
      });
      expect(await deps.harness.versionNumbers(first.publish.siteId)).toEqual([1]);
      expect(pointerOf(deps, first.publish.slug)?.version).toBe(1);
      expect((await deps.store.findSiteById(first.publish.siteId))?.completeLock).toBeNull();
    });

    it("reports a verified object GC is deleting as missing, without a HEAD", async () => {
      const deps = setup();
      await publish(deps);
      const begun = (await begin(deps))._unsafeUnwrap();
      const source = { kind: "source" as const, sha256: hex("source-1") };
      await deps.harness.markDeleting(USER, source);
      const heads = recordHeads(deps);
      const result = await completePublish(deps, USER, begun.publish.id);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: "UPLOAD_INCOMPLETE",
        details: { missing: [source] },
      });
      expect(heads).toEqual([]);
    });

    it("does not HEAD again, on a retry, what an earlier attempt found", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      const logo = begun.uploads.find((u) => u.path === "logo.png")!;
      performUploads(
        deps,
        begun.uploads.filter((u) => u !== logo),
      );
      const heads = recordHeads(deps);
      const first = await completePublish(deps, USER, begun.publish.id);
      expect(first._unsafeUnwrapErr()).toMatchObject({
        code: "UPLOAD_INCOMPLETE",
        details: { missing: [{ kind: "site", sha256: logo.sha256, path: "logo.png" }] },
      });
      expect(heads).toHaveLength(begun.uploads.length);

      heads.length = 0;
      performUploads(deps, [logo]);
      expect((await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap().version).toBe(1);
      expect(heads).toEqual([siteContentKey(USER, logo.sha256)]);
    });

    it("stops HEADing once it has found as many missing objects as it reports", async () => {
      const deps = setup();
      const files = Array.from({ length: 400 }, (_, i) => ({ path: `f/${i}.txt`, size: 0 }));
      const begun = (await begin(deps, { files }))._unsafeUnwrap();
      const heads = recordHeads(deps);
      const error = (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrapErr();
      expect(error.code).toBe("UPLOAD_INCOMPLETE");
      expect((error.details as { missing: unknown[] }).missing).toHaveLength(50);
      // At most one round of HEADs in flight past the 50th miss.
      expect(heads.length).toBeLessThanOrEqual(100);
    });

    it("releases the lock when a store call throws after taking it", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const commit = deps.store.commitVersion;
      deps.store.commitVersion = async () => {
        throw new Error("D1 hiccup");
      };
      const failed = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(failed._unsafeUnwrapErr()).toMatchObject({
        status: 500,
        code: "PUBLISH_STORE_FAILED",
      });
      expect((await deps.store.findSiteById(begun.publish.siteId))?.completeLock).toBeNull();
      expect((await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap().version).toBe(1);
    });

    it("lets a session take back the lock a dead request of it left, but no other session", async () => {
      const deps = setup();
      const other = (await begin(deps, { entries: defaultEntries("other") }))._unsafeUnwrap();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, [...other.uploads, ...begun.uploads]);
      // A request of `begun` that died holding the lock.
      const now = deps.clock.now;
      expect(
        await deps.store.claimCompleteLock({
          siteId: begun.publish.siteId,
          sessionId: begun.publish.id,
          baseVersion: 0,
          now,
          expiresAt: now + 600_000,
        }),
      ).not.toBeNull();
      deps.clock.now += 5_000;
      const busy = await completePublish(deps, USER, other.publish.id);
      expect(busy._unsafeUnwrapErr().code).toBe("PUBLISH_IN_PROGRESS");
      expect((await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap().version).toBe(1);
    });

    it("answers a retry that lost the commit to its own session's request with the result", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const commit = deps.store.commitVersion;
      let raced = false;
      deps.store.commitVersion = async (v) => {
        if (!raced) {
          raced = true;
          // The request this one retried commits first.
          (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap();
        }
        return commit(v);
      };
      const result = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(result._unsafeUnwrap()).toMatchObject({ version: 1, site: { headVersion: 1 } });
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([1]);
    });

    it("refuses with 410 when a GC run retired the session while it was committing", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.clock.now += SESSION_TTL_MS - 1_000;
      const commit = deps.store.commitVersion;
      let report: Awaited<ReturnType<typeof runGc>> | undefined;
      let lockHeld = false;
      deps.store.commitVersion = async (v) => {
        // The hold ends (GC's margin with it) and GC claims and deletes the
        // unverified objects, then retires the session (its session objects
        // go), before the commit.
        deps.clock.now += 2_000 + GC_CLOCK_SKEW_MARGIN_MS;
        report = await runGc(deps.gc, new Date(deps.clock.now));
        lockHeld = (await deps.store.findSiteById(v.siteId))?.completeLock === v.sessionId;
        return commit(v);
      };
      const result = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(report).toMatchObject({ expiredSessions: 1, retiredSessions: 1 });
      expect(report!.deletedObjects).toBeGreaterThan(0);
      expect(lockHeld).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 410, code: "PUBLISH_EXPIRED" });
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([]);
      const site = await deps.store.findSiteById(begun.publish.siteId);
      expect(site).toMatchObject({ headVersion: 0, completeLock: null });
      expect((await deps.store.getSession(begun.publish.id))?.status).toBe("expired");
    });

    it("refuses with 410 when a session object is gone, even while the hold looks live to its clock", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const commit = deps.store.commitVersion;
      deps.store.commitVersion = async (v) => {
        // GC, whose clock runs ahead of this Worker's, retired the blob's
        // session object; the stored objects themselves are still there.
        await deps.harness.dropSessionObject(v.sessionId, "blob");
        return commit(v);
      };
      const result = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 410, code: "PUBLISH_EXPIRED" });
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([]);
      expect(
        (await deps.store.getStoredObjects(USER, [{ kind: "blob", sha256: hex("blob-1") }]))[0]
          ?.verified,
      ).toBe(false);
    });

    it("commits when GC, its clock ahead by less than its margin, runs as the hold ends", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.clock.now += SESSION_TTL_MS - 1_000;
      const commit = deps.store.commitVersion;
      let report: Awaited<ReturnType<typeof runGc>> | undefined;
      deps.store.commitVersion = async (v) => {
        // This Worker's clock still reads a live hold; GC's reads it ended a
        // minute ago, which is within the margin: GC must leave it alone.
        report = await runGc(deps.gc, new Date(deps.clock.now + 61_000));
        return commit(v);
      };
      const result = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(report).toMatchObject({ deletedObjects: 0, retiredSessions: 0 });
      expect(result._unsafeUnwrap()).toMatchObject({ version: 1 });
      expect(deps.sourcesBucket.objects.has(sourceKey(USER, hex("source-1")))).toBe(true);
      expect(deps.sourcesBucket.objects.has(blobKey(USER, hex("blob-1")))).toBe(true);
      expect(
        (await deps.store.getStoredObjects(USER, [{ kind: "source", sha256: hex("source-1") }]))[0],
      ).toMatchObject({ verified: true, deleting: false });
    });

    it("refuses with 410 when GC, its clock ahead by more than its margin, retired the session before the commit", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.clock.now += SESSION_TTL_MS - 1_000;
      const commit = deps.store.commitVersion;
      let report: Awaited<ReturnType<typeof runGc>> | undefined;
      deps.store.commitVersion = async (v) => {
        // This Worker's clock still reads a live hold; GC's does not, even
        // with its margin.
        report = await runGc(deps.gc, new Date(deps.clock.now + GC_CLOCK_SKEW_MARGIN_MS + 2_000));
        return commit(v);
      };
      const result = await completePublish(deps, USER, begun.publish.id);
      deps.store.commitVersion = commit;
      expect(report).toMatchObject({ retiredSessions: 1 });
      expect(report!.deletedObjects).toBeGreaterThan(0);
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 410, code: "PUBLISH_EXPIRED" });
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([]);
    });

    it("refuses when the complete limiter says so, before touching storage", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.limits.complete = false;
      let heads = 0;
      for (const store of [deps.sources, deps.sites]) {
        const head = store.head.bind(store);
        store.head = async (key) => {
          heads++;
          return head(key);
        };
      }
      const result = await completePublish(deps, USER, begun.publish.id);
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 429, code: "RATE_LIMITED" });
      expect(heads).toBe(0);
      expect((await deps.store.findSiteById(begun.publish.siteId))?.completeLock).toBeNull();
      deps.limits.complete = true;
      expect((await completePublish(deps, USER, begun.publish.id)).isOk()).toBe(true);
    });
  });

  describe("open sessions", () => {
    it(`refuses a begin past ${MAX_OPEN_SESSIONS_PER_ACCOUNT} uncommitted held sessions, before creating a site`, async () => {
      const deps = setup();
      const T = deps.clock.now;
      for (let i = 0; i < MAX_OPEN_SESSIONS_PER_ACCOUNT; i++) {
        (await begin(deps, { entries: defaultEntries(`try-${i}`) }))._unsafeUnwrap();
      }
      const refused = await begin(deps, { workspace: workspaceId(2) });
      expect(refused._unsafeUnwrapErr()).toMatchObject({
        status: 429,
        code: "RATE_LIMITED",
        details: {
          reason: "open-sessions",
          limit: MAX_OPEN_SESSIONS_PER_ACCOUNT,
          open: MAX_OPEN_SESSIONS_PER_ACCOUNT,
        },
      });
      expect(await deps.store.findSiteByWorkspace(USER, workspaceId(2))).toBeNull();
      // Another account is unaffected; the holds end with the URLs.
      expect((await begin(deps, {}, OTHER)).isOk()).toBe(true);
      deps.clock.now = T + SESSION_TTL_MS + 1;
      expect((await begin(deps, { workspace: workspaceId(2) })).isOk()).toBe(true);
    });

    it("does not count committed sessions", async () => {
      const deps = setup();
      for (let i = 0; i < MAX_OPEN_SESSIONS_PER_ACCOUNT + 2; i++) {
        await publish(deps, { entries: defaultEntries(`v${i}`) });
      }
      expect(await deps.store.openSessions(USER, deps.clock.now)).toEqual({
        count: 0,
        siteUploadBytes: 0,
      });
    });

    it("re-checks after the insert, so concurrent begins cannot pass the limit together", async () => {
      const deps = setup();
      for (let i = 0; i < MAX_OPEN_SESSIONS_PER_ACCOUNT; i++) {
        (await begin(deps, { entries: defaultEntries(`try-${i}`) }))._unsafeUnwrap();
      }
      // This begin's first look raced ahead of the others' inserts.
      const open = deps.store.openSessions;
      let calls = 0;
      deps.store.openSessions = async (userId, now) =>
        ++calls === 1 ? { count: 0, siteUploadBytes: 0 } : open(userId, now);
      const refused = await begin(deps, { entries: defaultEntries("racer") });
      deps.store.openSessions = open;
      expect(refused._unsafeUnwrapErr()).toMatchObject({ status: 429, code: "RATE_LIMITED" });
      expect((await deps.store.openSessions(USER, deps.clock.now)).count).toBe(
        MAX_OPEN_SESSIONS_PER_ACCOUNT,
      );
      // The refused session is gone, plan and all.
      expect((await deps.harness.sessionRows(USER)).count).toBe(MAX_OPEN_SESSIONS_PER_ACCOUNT);
    });

    it("stubs a session's plan when it commits", async () => {
      const deps = setup();
      const { begun } = await publish(deps);
      expect((await deps.store.getSession(begun.publish.id))?.plan).toBe(PLAN_STUB);
      // Complete stays idempotent without it.
      expect((await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap()).toMatchObject({
        version: 1,
      });
    });
  });

  describe("pending site uploads", () => {
    const siteOf = (n: number, size: number): PlanInput => ({
      workspace: workspaceId(n),
      files: [{ path: `assets/big-${n}.js`, size, immutable: true }],
    });
    // Every session of these sites also carries the entry pages' contents,
    // uncommitted until one of them commits.
    const E = Object.values(defaultEntries()).reduce(
      (a, text) => a + new TextEncoder().encode(text).length,
      0,
    );

    it("refuses new site uploads past 1 GiB across the account's uncommitted sessions", async () => {
      const deps = setup();
      (await begin(deps, siteOf(1, 450 * MiB)))._unsafeUnwrap();
      (await begin(deps, siteOf(2, 450 * MiB)))._unsafeUnwrap();
      const refused = await begin(deps, siteOf(3, 200 * MiB));
      expect(refused._unsafeUnwrapErr()).toMatchObject({
        status: 413,
        code: "QUOTA_EXCEEDED",
        details: {
          reason: "pending-site",
          quotaBytes: MAX_PENDING_SITE_BYTES,
          usedBytes: 900 * MiB + 2 * E,
          publishBytes: 200 * MiB + E,
        },
      });
      // Refused before a session was created.
      expect((await deps.store.openSessions(USER, deps.clock.now)).count).toBe(2);
    });

    it("releases a session's pending bytes when it commits", async () => {
      const deps = setup();
      const first = (await begin(deps, siteOf(1, 450 * MiB)))._unsafeUnwrap();
      (await begin(deps, siteOf(2, 450 * MiB)))._unsafeUnwrap();
      performUploads(deps, first.uploads);
      (await completePublish(deps, USER, first.publish.id))._unsafeUnwrap();
      expect((await begin(deps, siteOf(3, 200 * MiB))).isOk()).toBe(true);
    });

    it("keeps counting an aborted session's bytes until its hold ends", async () => {
      const deps = setup();
      const T = deps.clock.now;
      const first = (await begin(deps, siteOf(1, 450 * MiB)))._unsafeUnwrap();
      (await begin(deps, siteOf(2, 450 * MiB)))._unsafeUnwrap();
      (await abortPublish(deps, USER, first.publish.id))._unsafeUnwrap();
      expect((await begin(deps, siteOf(3, 200 * MiB)))._unsafeUnwrapErr().code).toBe(
        "QUOTA_EXCEEDED",
      );
      // Expiry: the URLs stop working with the hold.
      deps.clock.now = T + SESSION_TTL_MS + 1;
      expect((await begin(deps, siteOf(3, 200 * MiB))).isOk()).toBe(true);
    });

    it("re-checks after the insert, releasing what the refused begin needed", async () => {
      const deps = setup();
      (await begin(deps, siteOf(1, 450 * MiB)))._unsafeUnwrap();
      (await begin(deps, siteOf(2, 450 * MiB)))._unsafeUnwrap();
      const open = deps.store.openSessions;
      let calls = 0;
      deps.store.openSessions = async (userId, now) =>
        ++calls === 1 ? { count: 0, siteUploadBytes: 0 } : open(userId, now);
      const refused = await begin(deps, {
        ...siteOf(3, 200 * MiB),
        source: { sha256: hex("s3"), size: 10 },
      });
      deps.store.openSessions = open;
      expect(refused._unsafeUnwrapErr()).toMatchObject({
        code: "QUOTA_EXCEEDED",
        details: {
          reason: "pending-site",
          usedBytes: 900 * MiB + 2 * E,
          publishBytes: 200 * MiB + E,
        },
      });
      expect((await deps.store.openSessions(USER, deps.clock.now)).siteUploadBytes).toBe(
        900 * MiB + 2 * E,
      );
      expect(
        await deps.store.getStoredObjects(USER, [{ kind: "source", sha256: hex("s3") }]),
      ).toEqual([]);
      expect((await deps.harness.sessionRows(USER)).count).toBe(2);
    });

    it("keeps an aborted session's hold when it was given only site URLs (Q9)", async () => {
      const deps = setup();
      await publish(deps);
      const begun = (
        await begin(deps, { files: [{ path: "new.js" }], entries: defaultEntries("v2") })
      )._unsafeUnwrap();
      expect(kinds(begun.uploads)).toEqual(["site", "site", "site", "site"]);
      (await abortPublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      expect((await deps.store.getSession(begun.publish.id))?.holdUntil).toBe(
        deps.clock.now + SESSION_TTL_MS,
      );
    });
  });

  describe("stored site bytes", () => {
    const siteOf = (n: number, size: number): PlanInput => ({
      workspace: workspaceId(n),
      files: [{ path: `assets/big-${n}.js`, size, immutable: true }],
    });
    // The entry pages' contents, the same for every site here: stored once.
    const E = Object.values(defaultEntries()).reduce(
      (a, text) => a + new TextEncoder().encode(text).length,
      0,
    );

    it(`refuses a publish that adds site bytes past ${MAX_STORED_SITE_BYTES / MiB} MiB, committed ones included`, async () => {
      const deps = setup();
      // Committed contents free the pending-site cap, but still count here.
      for (let n = 1; n <= 9; n++) await publish(deps, siteOf(n, 450 * MiB));
      const refused = await begin(deps, siteOf(10, 100 * MiB));
      expect(refused._unsafeUnwrapErr()).toMatchObject({
        status: 413,
        code: "QUOTA_EXCEEDED",
        details: {
          reason: "site-storage",
          quotaBytes: MAX_STORED_SITE_BYTES,
          usedBytes: 9 * 450 * MiB + E,
          publishBytes: 100 * MiB,
        },
      });
      // Deleted, holding nothing.
      expect((await deps.store.openSessions(USER, deps.clock.now)).count).toBe(0);
      expect(
        await deps.store.getStoredObjects(USER, [
          { kind: "site", sha256: hex("site-assets/big-10.js") },
        ]),
      ).toEqual([]);
      // Contents the account already has add nothing.
      expect((await begin(deps, { ...siteOf(1, 450 * MiB), name: "Again" })).isOk()).toBe(true);
    });

    it("keeps counting contents no retained version lists until GC removes them", async () => {
      const deps = setup();
      for (let v = 1; v <= 9; v++) {
        await publish(deps, {
          files: [{ path: `assets/big-${v}.js`, size: 450 * MiB, immutable: true }],
        });
      }
      const site = await deps.store.findSiteByWorkspace(USER, WORKSPACE);
      // v1 to v4 were pruned; their contents wait out GC's age floor.
      expect(await deps.harness.versionNumbers(site!.id)).toEqual([5, 6, 7, 8, 9]);
      const more = { files: [{ path: "x.js", size: 100 * MiB }] };
      expect((await begin(deps, more))._unsafeUnwrapErr()).toMatchObject({
        code: "QUOTA_EXCEEDED",
        details: { reason: "site-storage" },
      });
      deps.clock.now += 25 * 3600_000;
      await runGc(deps.gc, deps.now());
      expect((await begin(deps, more)).isOk()).toBe(true);
    });

    it("lets a publish that adds no site bytes through, even over the cap", async () => {
      const deps = setup();
      await publish(deps);
      const stored = deps.store.storedSiteBytes;
      deps.store.storedSiteBytes = async () => MAX_STORED_SITE_BYTES + 1;
      expect((await begin(deps)).isOk()).toBe(true);
      deps.store.storedSiteBytes = stored;
    });
  });

  describe("site file rows", () => {
    const rowBytes = (files: { path: string; contentType: string }[]) =>
      files.reduce((a, f) => a + siteFileRowBytes(f), 0);

    it("keeps every file of the head, and only the grace candidates of older versions", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const siteId = first.publish.siteId;
      await publish(deps, { entries: defaultEntries("v2") });
      expect(await deps.harness.siteFileRows(siteId)).toEqual([
        "1:_antidraw/viewer-AbC12345.js",
        "1:assets/index-AbC12345.js",
        "2:_antidraw/viewer-AbC12345.js",
        "2:assets/index-AbC12345.js",
        "2:canvas.json",
        "2:index.html",
        "2:logo.png",
        "2:preview.html",
      ]);
      const head = (await beginRequest({ entries: defaultEntries("v2") })).site.files;
      const grace = (await beginRequest()).site.files.filter((f) => f.immutable);
      expect(await deps.store.siteFileRowBytes(USER)).toBe(rowBytes(head) + rowBytes(grace));
    });

    it("marks only build-named files immutable, and never keeps a public file as a grace entry", async () => {
      const deps = setup();
      const files = [
        { path: "assets/index-AbC12345.js", immutable: true, contentType: "text/javascript" },
        // A public file whose name looks hashed: the build did not name it.
        { path: "assets/logo-original.png", contentType: "image/png" },
        // The build's flag outside where the build names files counts for nothing.
        { path: "robots.txt", immutable: true, contentType: "text/plain" },
      ];
      const { begun } = await publish(deps, { files });
      const slug = begun.publish.slug;
      const v1 = pointerOf(deps, slug)!;
      expect(v1.files["assets/index-AbC12345.js"].i).toBe(1);
      expect(v1.files["assets/logo-original.png"]).not.toHaveProperty("i");
      expect(v1.files["robots.txt"]).not.toHaveProperty("i");
      expect(v1.files["index.html"]).not.toHaveProperty("i");

      // v2 removes the public file and robots.txt: they are off the site at once.
      await publish(deps, { files: [files[0]], entries: defaultEntries("v2") });
      const v2 = pointerOf(deps, slug)!;
      expect(v2.version).toBe(2);
      expect(Object.keys(v2.files).sort()).toEqual(
        ["assets/index-AbC12345.js", "canvas.json", "index.html", "preview.html"].sort(),
      );
      expect(await deps.harness.siteFileRows(begun.publish.siteId)).toEqual([
        "1:assets/index-AbC12345.js",
        "2:assets/index-AbC12345.js",
        "2:canvas.json",
        "2:index.html",
        "2:preview.html",
      ]);
    });

    it("keeps every file of the version the pointer is still at", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const siteId = first.publish.siteId;
      const slug = first.publish.slug;
      const begun = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.sitesBucket.failPut = (key) => key === pointerKey(slug);
      expect((await completePublish(deps, USER, begun.publish.id)).isErr()).toBe(true);
      expect(pointerOf(deps, slug)?.version).toBe(1);
      const v1Rows = async () =>
        (await deps.harness.siteFileRows(siteId)).filter((r) => r.startsWith("1:"));
      expect(await v1Rows()).toHaveLength(6);

      deps.sitesBucket.failPut = () => false;
      (await completePublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      expect(await v1Rows()).toEqual([
        "1:_antidraw/viewer-AbC12345.js",
        "1:assets/index-AbC12345.js",
      ]);
    });

    it(`refuses a publish that would take the account's rows past ${MAX_SITE_FILE_ROW_BYTES / MiB} MiB`, async () => {
      const deps = setup();
      await publish(deps);
      const req = await beginRequest({ workspace: workspaceId(2), name: "Other" });
      const adds = rowBytes(req.site.files);
      const actual = deps.store.siteFileRowBytes;
      // The account's rows, as if just under the cap before this plan.
      const room = async (spare: number) => {
        const used = await actual(USER);
        deps.store.siteFileRowBytes = async (u) =>
          (await actual(u)) + MAX_SITE_FILE_ROW_BYTES - used - adds - spare;
      };
      await room(-1);
      const refused = await beginPublish(deps, USER, req);
      expect(refused._unsafeUnwrapErr()).toMatchObject({
        status: 413,
        code: "QUOTA_EXCEEDED",
        details: {
          reason: "site-files",
          quotaBytes: MAX_SITE_FILE_ROW_BYTES,
          usedBytes: MAX_SITE_FILE_ROW_BYTES - adds + 1,
          publishBytes: adds,
        },
      });
      // Refused before a site or a session was created.
      expect(await deps.store.findSiteByWorkspace(USER, workspaceId(2))).toBeNull();
      await room(0);
      expect((await beginPublish(deps, USER, req)).isOk()).toBe(true);
    });
  });

  describe("status", () => {
    it("reports a session's status and result version to its owner only", async () => {
      const deps = setup();
      const { begun } = await publish(deps);
      expect((await getPublishSession(deps, USER, begun.publish.id))._unsafeUnwrap()).toMatchObject(
        {
          status: "completed",
          resultVersion: 1,
          site: { siteId: begun.publish.siteId, headVersion: 1 },
        },
      );
      expect(
        (await getPublishSession(deps, OTHER, begun.publish.id))._unsafeUnwrapErr(),
      ).toMatchObject({
        status: 404,
        code: "PUBLISH_NOT_FOUND",
      });

      const pending = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      expect(
        (await getPublishSession(deps, USER, pending.publish.id))._unsafeUnwrap(),
      ).toMatchObject({
        status: "pending",
        resultVersion: null,
      });
      deps.clock.now += SESSION_TTL_MS + 1;
      expect((await getPublishSession(deps, USER, pending.publish.id))._unsafeUnwrap().status).toBe(
        "expired",
      );
    });

    it("reports the workspace's site, or null", async () => {
      const deps = setup();
      expect((await getSiteStatus(deps, USER, WORKSPACE))._unsafeUnwrap()).toEqual({ site: null });
      const { completed } = await publish(deps);
      expect((await getSiteStatus(deps, USER, WORKSPACE))._unsafeUnwrap()).toEqual({
        site: completed.site,
      });
      expect((await getSiteStatus(deps, OTHER, WORKSPACE))._unsafeUnwrap()).toEqual({ site: null });
    });
  });
});

describe("makePublishDeps", () => {
  const devEnv = { ...stubEnv, STORAGE_MODE: "worker" };

  it("refuses an auth URL under the site domain", () => {
    for (const BETTER_AUTH_URL of ["https://auth.antidraw.app", "https://antidraw.app"]) {
      const result = makePublishDeps({
        ...devEnv,
        BETTER_AUTH_URL,
        SITE_URL_TEMPLATE: "https://{slug}.antidraw.app",
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 500, code: "CONFIG_INVALID" });
    }
  });

  it("accepts production and localhost dev values", () => {
    expect(
      makePublishDeps({
        ...devEnv,
        BETTER_AUTH_URL: "https://api.antidraw.com",
        SITE_URL_TEMPLATE: "https://{slug}.antidraw.app",
      }).isOk(),
    ).toBe(true);
    expect(
      makePublishDeps({
        ...devEnv,
        BETTER_AUTH_URL: "http://localhost:8799",
        SITE_URL_TEMPLATE: "http://{slug}.localhost:8787",
      }).isOk(),
    ).toBe(true);
  });

  it("fails closed without storage configuration", () => {
    expect(makePublishDeps(stubEnv)._unsafeUnwrapErr().code).toBe("STORAGE_MISCONFIGURED");
  });
});

import { describe, expect, it } from "vitest";
import { env as stubEnv } from "cloudflare:workers";
import {
  MAX_PLAN_JSON_BYTES,
  MAX_PROTECTED_JSON_BYTES,
  MAX_SITES_PER_ACCOUNT,
  QUOTA_BYTES,
  SESSION_TTL_MS,
} from "../lib/publish-limits";
import { beginPublishRequest } from "../lib/publish.schemas";
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
  unionProtected,
} from "./publish.service";

const USER = "user-1";
const OTHER = "user-2";

const begin = async (deps: TestDeps, input: PlanInput = {}, user = USER) =>
  beginPublish(deps, user, await beginRequest(input));

// begin -> every upload -> complete.
const publish = async (deps: TestDeps, input: PlanInput = {}, user = USER) => {
  const begun = (await begin(deps, input, user))._unsafeUnwrap();
  performUploads(deps, begun.uploads);
  const completed = await completePublish(
    deps,
    user,
    begun.publish.id,
    completeRequest(input.entries ?? defaultEntries()),
  );
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
      expect(kinds(begun.uploads)).toEqual(["blob", "site", "site", "site", "source"]);
      expect(begun.publish).toMatchObject({ baseVersion: 0, slug: "acme-canvas-saaab" });
      expect(begun.publish.expiresAt).toBe(new Date(deps.clock.now + SESSION_TTL_MS).toISOString());
      expect(completed.version).toBe(1);

      const again = (await begin(deps))._unsafeUnwrap();
      expect(again.uploads).toEqual([]);
      expect(again.publish).toMatchObject({ baseVersion: 1, siteId: begun.publish.siteId });
    });

    it("signs uploads with the right buckets, keys, types and cache control", async () => {
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
      const hashed = byKind("site", "assets/index-AbC12345.js");
      expect(hashed.url).toBe(
        "https://upload.test/sites/acme-canvas-saaab/assets/index-AbC12345.js",
      );
      expect(hashed.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(byKind("site", "logo.png").headers["cache-control"]).toBeUndefined();
      expect(byKind("source").headers["cache-control"]).toBeUndefined();
    });

    it("re-uploads a site file whose stored copy differs (repairs public files)", async () => {
      const deps = setup();
      const { begun } = await publish(deps);
      deps.sitesBucket.upload(`${begun.publish.slug}/logo.png`, {
        size: 1,
        sha256: hex("tampered"),
        contentType: "image/png",
      });
      const again = (await begin(deps))._unsafeUnwrap();
      expect(again.uploads.map((u) => u.path)).toEqual(["logo.png"]);
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
      const incomplete = await completePublish(deps, USER, second.publish.id, completeRequest());
      expect(incomplete._unsafeUnwrapErr()).toMatchObject({
        status: 409,
        code: "UPLOAD_INCOMPLETE",
        details: { missing: [{ kind: "blob", sha256: hex("blob-1") }] },
      });

      const third = (await begin(deps))._unsafeUnwrap();
      expect(kinds(third.uploads)).toEqual(["blob"]);
      performUploads(deps, third.uploads);
      (await completePublish(deps, USER, third.publish.id, completeRequest()))._unsafeUnwrap();
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
          { path: "index.html" },
          { path: "a/.b/c" },
        ],
      });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 422,
        code: "INVALID_PATH",
        details: { paths: ["public/.env", "index.html", "a/.b/c"] },
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
        details: { limitBytes: 500 * MiB, siteFileCount: 2 },
      });
    });

    it("refuses a plan too large to store", async () => {
      const deps = setup();
      // Within every per-file limit, but 2 500 long paths add up.
      const segment = "x".repeat(200);
      const files = Array.from({ length: 2500 }, (_, i) => ({
        path: `assets/${i}/${segment}/${segment}/${segment}.js`,
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
        (await begin(deps, { workspace: workspaceId(i) }))._unsafeUnwrap();
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
      const patched = await setAllowRemix(deps, USER, begun.publish.siteId, false);
      expect(patched._unsafeUnwrap().site.allowRemix).toBe(false);
      const done = await completePublish(
        deps,
        USER,
        inFlight.publish.id,
        completeRequest(defaultEntries("v2")),
      );
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

    it("marks a quota-refused session aborted with no hold", async () => {
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
      const site = await deps.store.findSiteByWorkspace(USER, workspaceId(3));
      expect(await deps.store.heldSessionPlans(site!.id, deps.clock.now)).toEqual([]);
      expect(await deps.store.getStoredObjects(USER, [{ kind: "blob", sha256: hex(3) }])).toEqual(
        [],
      );
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
      const begun = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      expect(begun.uploads).toEqual([]);
      (await abortPublish(deps, USER, begun.publish.id))._unsafeUnwrap();
      expect((await deps.store.getSession(begun.publish.id))?.holdUntil).toBeLessThanOrEqual(
        deps.clock.now,
      );
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
    it("writes the entries after verification, in order, and commits the version", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const writesBefore = deps.sitesBucket.writes.length;
      const done = (
        await completePublish(deps, USER, begun.publish.id, completeRequest())
      )._unsafeUnwrap();
      const slug = begun.publish.slug;
      expect(deps.sitesBucket.writes.slice(writesBefore)).toEqual([
        `${slug}/preview.html`,
        `${slug}/canvas.json`,
        `${slug}/index.html`,
      ]);
      const index = deps.sitesBucket.objects.get(`${slug}/index.html`)!;
      expect(index.contentType).toBe("text/html; charset=utf-8");
      expect(index.cacheControl).toBeUndefined();
      expect(deps.sitesBucket.objects.get(`${slug}/canvas.json`)?.contentType).toBe(
        "application/json; charset=utf-8",
      );
      expect(done).toMatchObject({
        version: 1,
        site: { slug, headVersion: 1, url: `https://${slug}.antidraw.test`, allowRemix: true },
      });
      expect(done.site.lastPublishedAt).toBe(new Date(deps.clock.now).toISOString());
      const site = await deps.store.findSiteById(begun.publish.siteId);
      expect(site).toMatchObject({ completeLock: null, protectedFiles: null });
      expect(JSON.parse(site!.liveFiles!)).toEqual([
        "_antidraw/viewer.js",
        "assets/index-AbC12345.js",
        "canvas.json",
        "index.html",
        "logo.png",
        "preview.html",
      ]);
    });

    it("refuses with UPLOAD_INCOMPLETE, writing nothing, when a site file is missing or differs", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(
        deps,
        begun.uploads.filter((u) => u.path !== "logo.png"),
      );
      deps.sitesBucket.upload(`${begun.publish.slug}/_antidraw/viewer.js`, {
        size: 101,
        sha256: hex("wrong"),
      });
      const writes = deps.sitesBucket.writes.length;
      const result = await completePublish(deps, USER, begun.publish.id, completeRequest());
      const error = result._unsafeUnwrapErr();
      expect(error).toMatchObject({ status: 409, code: "UPLOAD_INCOMPLETE" });
      expect(
        (error.details as { missing: { path?: string }[] }).missing.map((m) => m.path).sort(),
      ).toEqual(["_antidraw/viewer.js", "logo.png"]);
      expect(deps.sitesBucket.writes.length).toBe(writes);
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([]);
      expect((await deps.store.findSiteById(begun.publish.siteId))?.completeLock).toBeNull();

      // Upload the rest and it goes through.
      performUploads(deps, begun.uploads);
      expect((await completePublish(deps, USER, begun.publish.id, completeRequest())).isOk()).toBe(
        true,
      );
    });

    it("refuses entries that do not match the plan", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const result = await completePublish(
        deps,
        USER,
        begun.publish.id,
        completeRequest({ ...defaultEntries(), "canvas.json": '{"tag":"v9"}' }),
      );
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 422,
        code: "ENTRY_MISMATCH",
        details: { path: "canvas.json" },
      });
      const garbled = completeRequest();
      garbled.entries[0].contentBase64 = "%%%";
      expect(
        (await completePublish(deps, USER, begun.publish.id, garbled))._unsafeUnwrapErr().code,
      ).toBe("ENTRY_MISMATCH");
    });

    it("is idempotent once completed", async () => {
      const deps = setup();
      const { begun, completed } = await publish(deps);
      const writes = deps.sitesBucket.writes.length;
      const again = await completePublish(deps, USER, begun.publish.id, completeRequest());
      expect(again._unsafeUnwrap()).toEqual(completed);
      expect(deps.sitesBucket.writes.length).toBe(writes);
    });

    it("refuses an expired or aborted session with 410", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      deps.clock.now += SESSION_TTL_MS + 1;
      expect(
        (await completePublish(deps, USER, begun.publish.id, completeRequest()))._unsafeUnwrapErr(),
      ).toMatchObject({
        status: 410,
        code: "PUBLISH_EXPIRED",
      });

      const other = (await begin(deps))._unsafeUnwrap();
      (await abortPublish(deps, USER, other.publish.id))._unsafeUnwrap();
      expect(
        (await completePublish(deps, USER, other.publish.id, completeRequest()))._unsafeUnwrapErr()
          .code,
      ).toBe("PUBLISH_EXPIRED");
    });

    it("answers 404 for another user's session", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      expect(
        (await completePublish(deps, OTHER, begun.publish.id, completeRequest()))._unsafeUnwrapErr()
          .code,
      ).toBe("PUBLISH_NOT_FOUND");
    });

    it("lets the first of two sessions on one base win", async () => {
      const deps = setup();
      const a = (await begin(deps))._unsafeUnwrap();
      const b = (await begin(deps, { entries: defaultEntries("b") }))._unsafeUnwrap();
      performUploads(deps, [...a.uploads, ...b.uploads]);
      expect((await completePublish(deps, USER, a.publish.id, completeRequest())).isOk()).toBe(
        true,
      );
      const lost = await completePublish(
        deps,
        USER,
        b.publish.id,
        completeRequest(defaultEntries("b")),
      );
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
      const busy = await completePublish(deps, USER, begun.publish.id, completeRequest());
      expect(busy._unsafeUnwrapErr()).toMatchObject({ status: 409, code: "PUBLISH_IN_PROGRESS" });
      deps.clock.now += 60_001;
      expect((await completePublish(deps, USER, begun.publish.id, completeRequest())).isOk()).toBe(
        true,
      );
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

    it("fails the commit, not the pages, when GC claimed an object meanwhile", async () => {
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
      expect(claimed.map((c) => c.kind).sort()).toEqual(["blob", "source"]);

      // A begin while GC is deleting: it must upload again...
      const begun = (await begin(deps))._unsafeUnwrap();
      expect(kinds(begun.uploads)).toEqual(["blob", "source"]);
      performUploads(deps, begun.uploads);
      // ...and never commit against the doomed rows.
      const result = await completePublish(deps, USER, begun.publish.id, completeRequest());
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 409, code: "UPLOAD_INCOMPLETE" });
      expect(await deps.harness.versionNumbers(begun.publish.siteId)).toEqual([]);
    });

    it("catches a verified object removed from R2 out of band", async () => {
      const deps = setup();
      await publish(deps);
      deps.sourcesBucket.objects.delete(sourceKey(USER, hex("source-1")));
      const begun = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      expect(begun.uploads).toEqual([]);
      const result = await completePublish(
        deps,
        USER,
        begun.publish.id,
        completeRequest(defaultEntries("v2")),
      );
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: "UPLOAD_INCOMPLETE",
        details: { missing: [{ kind: "source", sha256: hex("source-1") }] },
      });
    });

    it("does not write entries when the lock has less than 60 s left (fence)", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      // Verification takes 9.5 of the lock's 10 minutes.
      const head = deps.sources.head.bind(deps.sources);
      deps.sources.head = async (key) => {
        deps.clock.now += 570_000;
        deps.sources.head = head;
        return head(key);
      };
      const writes = deps.sitesBucket.writes.length;
      const result = await completePublish(deps, USER, begun.publish.id, completeRequest());
      expect(result._unsafeUnwrapErr()).toMatchObject({ status: 409, code: "PUBLISH_IN_PROGRESS" });
      expect(deps.sitesBucket.writes.length).toBe(writes);
      expect((await deps.store.findSiteById(begun.publish.siteId))?.completeLock).toBeNull();
    });

    it("leaves the plan's paths protected when it fails after writing entries", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const input = {
        entries: defaultEntries("v2"),
        files: [
          { path: "assets/next-ZyX98765.js", immutable: true, contentType: "text/javascript" },
        ],
      };

      // STORAGE_FAILED on index.html, after preview.html and canvas.json went live.
      const second = (await begin(deps, input))._unsafeUnwrap();
      performUploads(deps, second.uploads);
      deps.sitesBucket.failPut = (key) => key.endsWith("/index.html");
      const failed = await completePublish(
        deps,
        USER,
        second.publish.id,
        completeRequest(input.entries),
      );
      expect(failed._unsafeUnwrapErr()).toMatchObject({ status: 500, code: "STORAGE_FAILED" });
      deps.sitesBucket.failPut = () => false;
      const site = await deps.store.findSiteById(first.publish.siteId);
      expect(site?.completeLock).toBeNull();
      expect(JSON.parse(site!.protectedFiles!)).toContain("assets/next-ZyX98765.js");

      // A commit that fails (the batch throws) leaves them protected too.
      const third = (await begin(deps, input))._unsafeUnwrap();
      performUploads(deps, third.uploads);
      const commit = deps.store.commitVersion;
      deps.store.commitVersion = async () => ({
        ok: false,
        reason: "other",
        error: new Error("D1 down"),
      });
      const broken = await completePublish(
        deps,
        USER,
        third.publish.id,
        completeRequest(input.entries),
      );
      expect(broken._unsafeUnwrapErr()).toMatchObject({
        status: 500,
        code: "PUBLISH_STORE_FAILED",
      });
      deps.store.commitVersion = commit;

      // GC after every hold has ended deletes none of what the live pages may use.
      deps.clock.now += SESSION_TTL_MS + 2 * 3600_000;
      await runGc(deps.gc, new Date(deps.clock.now));
      const keys = deps.sitesBucket.keys(`${first.publish.slug}/`);
      expect(keys).toContain(`${first.publish.slug}/assets/next-ZyX98765.js`);
      expect(keys).toContain(`${first.publish.slug}/assets/index-AbC12345.js`);
    });

    it("unions protected_files, retrying once when it changed underneath", async () => {
      const deps = setup();
      const { begun: first } = await publish(deps);
      const begun = (await begin(deps, { entries: defaultEntries("v2") }))._unsafeUnwrap();
      await deps.harness.setProtected(first.publish.siteId, JSON.stringify(["older.js"]));
      const claim = deps.store.claimCompleteLock;
      let calls = 0;
      let seenBySecond: string | null = null;
      deps.store.claimCompleteLock = async (c) => {
        calls++;
        if (calls === 1) {
          await deps.harness.setProtected(c.siteId, JSON.stringify(["older.js", "racer.js"]));
        }
        if (calls === 2) seenBySecond = c.protectedFiles;
        return claim(c);
      };
      // Fail verification so the lock claim's protected_files stays visible.
      deps.sitesBucket.objects.delete(`${first.publish.slug}/logo.png`);
      const result = await completePublish(
        deps,
        USER,
        begun.publish.id,
        completeRequest(defaultEntries("v2")),
      );
      expect(result._unsafeUnwrapErr().code).toBe("UPLOAD_INCOMPLETE");
      expect(calls).toBe(2);
      expect(JSON.parse(seenBySecond!)).toEqual(
        expect.arrayContaining(["older.js", "racer.js", "logo.png"]),
      );
      deps.store.claimCompleteLock = claim;

      // A commit clears it.
      performUploads(deps, [
        {
          kind: "site",
          sha256: hex("site-logo.png"),
          size: 102,
          path: "logo.png",
          url: `https://upload.test/sites/${first.publish.slug}/logo.png`,
          method: "PUT",
          headers: { "content-type": "image/png" },
        },
      ]);
      (
        await completePublish(deps, USER, begun.publish.id, completeRequest(defaultEntries("v2")))
      )._unsafeUnwrap();
      expect((await deps.store.findSiteById(first.publish.siteId))?.protectedFiles).toBeNull();
    });

    it("gives up with PUBLISH_IN_PROGRESS when protected_files keeps changing", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      performUploads(deps, begun.uploads);
      const claim = deps.store.claimCompleteLock;
      let n = 0;
      deps.store.claimCompleteLock = async (c) => {
        await deps.harness.setProtected(c.siteId, JSON.stringify([`racer-${++n}.js`]));
        return claim(c);
      };
      const result = await completePublish(deps, USER, begun.publish.id, completeRequest());
      expect(result._unsafeUnwrapErr().code).toBe("PUBLISH_IN_PROGRESS");
      expect(n).toBe(2);
    });

    it("collapses protected_files to * once too large", async () => {
      const deps = setup();
      const begun = (await begin(deps))._unsafeUnwrap();
      const huge = JSON.stringify(
        Array.from({ length: 2100 }, (_, i) => `${i}-${"p".repeat(850)}`),
      );
      await deps.harness.setProtected(begun.publish.siteId, huge);
      // Verification fails, so the claimed value stays for us to see.
      const result = await completePublish(deps, USER, begun.publish.id, completeRequest());
      expect(result._unsafeUnwrapErr().code).toBe("UPLOAD_INCOMPLETE");
      expect((await deps.store.findSiteById(begun.publish.siteId))?.protectedFiles).toBe("*");
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

describe("unionProtected", () => {
  it("unions and sorts, keeps *, and collapses past the limit", () => {
    expect(unionProtected(null, ["b", "a"])).toBe('["a","b"]');
    expect(unionProtected('["c","a"]', ["b", "a"])).toBe('["a","b","c"]');
    expect(unionProtected("*", ["a"])).toBe("*");
    const big = Array.from({ length: 3000 }, (_, i) => `${i}-${"x".repeat(600)}`);
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_PROTECTED_JSON_BYTES);
    expect(unionProtected(null, big)).toBe("*");
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

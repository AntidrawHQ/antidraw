import { describe, expect, it } from "vitest";
import { pointerKey } from "../lib/storage";
import { sha256Hex } from "../test/memory-object-store";
import {
  beginRequest,
  harnesses,
  hex,
  makeTestDeps,
  performUploads,
  pointerOf,
  type TestDeps,
} from "../test/publish-harness";
import { beginPublish, completePublish } from "./publish.service";
import type { VersionSiteFileRow } from "./publish.store";
import { buildPointer, syncPointer } from "./site-pointer";

const USER = "user-1";

// Immutable by default where the build names files by content.
const row = (
  version: number,
  path: string,
  sha = `${version}${path}`,
  immutable = /^(assets|_antidraw)\//.test(path),
): VersionSiteFileRow => ({
  version,
  path,
  sha256: hex(sha),
  size: version,
  contentType: "text/plain",
  immutable,
});

describe("buildPointer", () => {
  it("lists the head's files, then the immutable paths of up to four older versions", () => {
    const rows = [
      row(7, "index.html"),
      row(7, "assets/app-AAAAAAAA.js"),
      row(6, "index.html"),
      row(6, "assets/app-BBBBBBBB.js"),
      row(6, "logo.png"), // not immutable: an older version's is never served
      row(6, "assets/logo-original.png", undefined, false), // a public file: looks hashed, is not
      row(5, "_antidraw/viewer-CCCCCCCC.js"),
      row(5, "assets/app-AAAAAAAA.js", "older"), // the head defines it
      row(3, "assets/app-DDDDDDDD.js"),
      row(2, "assets/app-EEEEEEEE.js"), // beyond KEEP_VERSIONS - 1 back
    ];
    const built = buildPointer({ userId: USER }, 7, rows)!;
    const pointer = JSON.parse(built.json) as {
      v: number;
      version: number;
      u: string;
      files: Record<string, { h: string; s: number; t: string }>;
    };
    expect(pointer).toMatchObject({ v: 1, version: 7, u: USER });
    expect(Object.keys(pointer.files)).toEqual([
      "index.html",
      "assets/app-AAAAAAAA.js",
      "assets/app-BBBBBBBB.js",
      "_antidraw/viewer-CCCCCCCC.js",
      "assets/app-DDDDDDDD.js",
    ]);
    expect(pointer.files["assets/app-AAAAAAAA.js"]).toEqual({
      h: hex("7assets/app-AAAAAAAA.js"),
      s: 7,
      t: "text/plain",
      i: 1,
    });
    expect(pointer.files["index.html"]).toEqual({ h: hex("7index.html"), s: 7, t: "text/plain" });
    expect(built).toMatchObject({ graceEntries: 3, droppedGrace: 0 });
  });

  it("drops grace entries past the size cap, oldest first, never the head's", () => {
    const rows = [
      row(4, "index.html"),
      row(3, "assets/a-AAAAAAAA.js"),
      row(2, "assets/b-BBBBBBBB.js"),
      row(1, "assets/c-CCCCCCCC.js"),
    ];
    const full = buildPointer({ userId: USER }, 4, rows)!;
    const headOnly = buildPointer({ userId: USER }, 4, rows.slice(0, 1))!;
    // Room for exactly one grace entry.
    const oneEntry = (full.json.length - headOnly.json.length) / 3;
    const capped = buildPointer({ userId: USER }, 4, rows, headOnly.json.length + oneEntry + 5)!;
    expect(Object.keys(JSON.parse(capped.json).files)).toEqual([
      "index.html",
      "assets/a-AAAAAAAA.js",
    ]);
    expect(capped).toMatchObject({ graceEntries: 1, droppedGrace: 2 });
    expect(capped.json.length).toBeLessThanOrEqual(headOnly.json.length + oneEntry + 5);
    // The head always goes in whole.
    const tiny = buildPointer({ userId: USER }, 4, rows, 10)!;
    expect(Object.keys(JSON.parse(tiny.json).files)).toEqual(["index.html"]);
  });

  it("keeps a path such as __proto__ an own entry", () => {
    const built = buildPointer({ userId: USER }, 1, [row(1, "__proto__"), row(1, "index.html")])!;
    const files = JSON.parse(built.json).files as Record<string, unknown>;
    expect(Object.hasOwn(files, "__proto__")).toBe(true);
    expect(Object.keys(files)).toEqual(["__proto__", "index.html"]);
  });

  it("is null when the head has no files", () => {
    expect(buildPointer({ userId: USER }, 3, [row(2, "index.html")])).toBeNull();
  });
});

describe.each(harnesses)("syncPointer (%s)", (_name, makeHarness) => {
  const setup = () => {
    const harness = makeHarness();
    harness.addUser(USER);
    return makeTestDeps(harness);
  };

  // A committed version whose pointer was not written.
  const committed = async (deps: TestDeps) => {
    const begun = (await beginPublish(deps, USER, await beginRequest()))._unsafeUnwrap();
    performUploads(deps, begun.uploads);
    const slug = begun.publish.slug;
    deps.sitesBucket.failPut = (key) => key === pointerKey(slug);
    await completePublish(deps, USER, begun.publish.id);
    deps.sitesBucket.failPut = () => false;
    return (await deps.store.findSiteById(begun.publish.siteId))!;
  };

  const putPointer = async (deps: TestDeps, slug: string, text: string) => {
    await deps.sites.put(pointerKey(slug), new TextEncoder().encode(text), {
      size: new TextEncoder().encode(text).length,
      sha256: await sha256Hex(text),
      contentType: "application/json",
    });
  };

  it("creates the pointer only if there is none", async () => {
    const deps = setup();
    const site = await committed(deps);
    expect(pointerOf(deps, site.slug)).toBeNull();
    // Another writer creates it between the read and the put.
    deps.sitesBucket.beforePut = async (key) => {
      deps.sitesBucket.beforePut = () => {};
      await putPointer(deps, site.slug, JSON.stringify({ v: 1, version: 5, u: USER, files: {} }));
      expect(key).toBe(pointerKey(site.slug));
    };
    expect(await syncPointer(deps, site)).toBe("current");
    expect(pointerOf(deps, site.slug)?.version).toBe(5);
  });

  it("retries once when the pointer changed under it, and never goes back a version", async () => {
    const deps = setup();
    const site = await committed(deps);
    await putPointer(deps, site.slug, JSON.stringify({ v: 1, version: 0, u: USER, files: {} }));
    let raced = 0;
    deps.sitesBucket.beforePut = async () => {
      // Once: the racing writer's own put and the retry go straight through.
      if (raced++ > 0) return;
      // An older writer lands first: still behind, so the retry writes.
      await putPointer(deps, site.slug, JSON.stringify({ v: 1, version: 0, u: "x", files: {} }));
    };
    expect(await syncPointer(deps, site)).toBe("written");
    expect(pointerOf(deps, site.slug)).toMatchObject({ version: 1, u: USER });
    expect((await deps.store.findSiteById(site.id))?.pointerVersion).toBe(1);
  });

  it("gives up after two lost races", async () => {
    const deps = setup();
    const site = await committed(deps);
    let inside = false;
    deps.sitesBucket.beforePut = async () => {
      if (inside) return; // the racing writer's own put
      inside = true;
      await putPointer(deps, site.slug, JSON.stringify({ v: 1, version: 0, u: USER, files: {} }));
      inside = false;
    };
    expect(await syncPointer(deps, site)).toBe("raced");
    expect((await deps.store.findSiteById(site.id))?.pointerVersion).toBe(0);
  });

  it("replaces a pointer it cannot read", async () => {
    const deps = setup();
    const site = await committed(deps);
    await putPointer(deps, site.slug, "not json");
    expect(await syncPointer(deps, site)).toBe("written");
    expect(pointerOf(deps, site.slug)?.version).toBe(1);
  });
});

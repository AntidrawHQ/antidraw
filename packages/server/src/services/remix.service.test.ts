import { describe, expect, it } from "vitest";
import { blobKey, sourceKey } from "../lib/storage";
import {
  beginRequest,
  harnesses,
  hex,
  makeTestDeps,
  MiB,
  performUploads,
  type PlanInput,
  type TestDeps,
} from "../test/publish-harness";
import { beginPublish, completePublish, setAllowRemix } from "./publish.service";
import { remixSite } from "./remix.service";

const OWNER = "owner";
const VISITOR = "visitor";

const publish = async (deps: TestDeps, input: PlanInput = {}) => {
  const begun = (await beginPublish(deps, OWNER, await beginRequest(input)))._unsafeUnwrap();
  performUploads(deps, begun.uploads);
  return (await completePublish(deps, OWNER, begun.publish.id))._unsafeUnwrap();
};

describe.each(harnesses)("remix service (%s)", (_name, makeHarness) => {
  const setup = () => {
    const harness = makeHarness();
    harness.addUser(OWNER);
    harness.addUser(VISITOR);
    return makeTestDeps(harness);
  };

  it("signs 10-minute URLs for the owner's source and each distinct blob", async () => {
    const deps = setup();
    const shared = { sha256: hex("same"), size: 2 * MiB };
    const { site } = await publish(deps, {
      name: "Remix Me",
      largeFiles: [
        { path: "a/one.bin", ...shared },
        { path: "b/two.bin", ...shared, mode: 493 },
        { path: "c.mp4", sha256: hex("other"), size: 3 * MiB },
      ],
    });

    const { remix } = (await remixSite(deps, VISITOR, site.slug))._unsafeUnwrap();
    expect(remix).toMatchObject({
      slug: site.slug,
      name: "Remix Me",
      version: 1,
      publishedAt: new Date(deps.clock.now).toISOString(),
      expiresAt: new Date(deps.clock.now + 600_000).toISOString(),
      source: {
        sha256: hex("source-1"),
        size: 1000,
        url: `https://download.test/sources/${sourceKey(OWNER, hex("source-1"))}`,
      },
    });
    expect(remix.largeFiles).toEqual([
      {
        path: "a/one.bin",
        sha256: hex("same"),
        size: 2 * MiB,
        mode: 420,
        url: `https://download.test/sources/${blobKey(OWNER, hex("same"))}`,
      },
      {
        path: "b/two.bin",
        sha256: hex("same"),
        size: 2 * MiB,
        mode: 493,
        url: `https://download.test/sources/${blobKey(OWNER, hex("same"))}`,
      },
      {
        path: "c.mp4",
        sha256: hex("other"),
        size: 3 * MiB,
        mode: 420,
        url: `https://download.test/sources/${blobKey(OWNER, hex("other"))}`,
      },
    ]);
  });

  it("refuses others when remix is off, and still serves the owner", async () => {
    const deps = setup();
    const { site } = await publish(deps);
    (await setAllowRemix(deps, OWNER, site.siteId, false))._unsafeUnwrap();
    expect((await remixSite(deps, VISITOR, site.slug))._unsafeUnwrapErr()).toMatchObject({
      status: 403,
      code: "REMIX_DISABLED",
    });
    expect((await remixSite(deps, OWNER, site.slug)).isOk()).toBe(true);

    // The setting is read from the site, so turning it back on works at once.
    (await setAllowRemix(deps, OWNER, site.siteId, true))._unsafeUnwrap();
    expect((await remixSite(deps, VISITOR, site.slug)).isOk()).toBe(true);
  });

  it("answers SITE_NOT_FOUND for a site that never completed, or no site", async () => {
    const deps = setup();
    const begun = (await beginPublish(deps, OWNER, await beginRequest()))._unsafeUnwrap();
    for (const slug of [begun.publish.slug, "no-such-site"]) {
      expect((await remixSite(deps, OWNER, slug))._unsafeUnwrapErr()).toMatchObject({
        status: 404,
        code: "SITE_NOT_FOUND",
      });
    }
  });

  it("is rate limited", async () => {
    const deps = setup();
    const { site } = await publish(deps);
    deps.limits.remix = false;
    expect((await remixSite(deps, VISITOR, site.slug))._unsafeUnwrapErr()).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });
});

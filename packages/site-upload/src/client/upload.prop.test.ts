import fc from "fast-check";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTestWorker, uniqueSite, type TestWorker } from "../../test/helpers";
import { SiteStore } from "../server/store";
import type { UploadTransport } from "./http";
import { uploadSite } from "./upload";

// Property tests: fast-check generates inputs, and a failure prints the
// smallest one it found.
//
// What an upload reports against what it did, for any site: files that share
// content (one upload for all of them), and a server that already has some of
// it from an earlier publish. unchangedFiles counts paths, as totalFiles does,
// so it's the paths whose content was already there, not totalFiles minus the
// uploads.

let env: TestWorker;
beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

/** A transport straight to a real SiteStore, which records what's stored. */
const transport = (store: SiteStore, site: string, publishId: string): UploadTransport => ({
  plan: async (manifest) => store.plan(site, publishId, JSON.parse(JSON.stringify(manifest))),
  put: async (hash, body) => {
    const bytes = new Uint8Array(await body.arrayBuffer());
    await store.putFile(site, publishId, hash, bytes, bytes.length);
  },
  commit: async () => {
    await store.requireComplete(site, publishId);
    return { publishId, previous: null, alreadyCommitted: false };
  },
});

const upload = async (files: Record<string, string>, store: SiteStore, site: string, publishId: string) => {
  const dir = await mkdtemp(join(tmpdir(), "site-upload-prop-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    return await uploadSite({ dir, transport: transport(store, site, publishId), retryDelayMs: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// Few contents for many paths, so files share content often.
const CONTENTS = ["home", "logo", "app", "style", "data"];
const path = fc.stringMatching(/^[a-z]{1,4}(\/[a-z]{1,4})?\.txt$/);
const site = fc.dictionary(path, fc.constantFrom(...CONTENTS), { minKeys: 1, maxKeys: 10 });

it("counts as unchanged exactly the files whose content the server already had", async () => {
  await fc.assert(
    fc.asyncProperty(site, fc.subarray(CONTENTS), async (files, before) => {
      const store = new SiteStore({ bucket: env.bucket });
      const id = uniqueSite();
      // An earlier publish of the site, which stored these contents.
      if (before.length) await upload(Object.fromEntries(before.map((c) => [`old/${c}.txt`, c])), store, id, "p1");

      const result = await upload(files, store, id, "p2");

      const paths = Object.values(files);
      const had = new Set(before);
      const sent = new Set(paths.filter((content) => !had.has(content)));
      expect({
        totalFiles: result.totalFiles,
        unchangedFiles: result.unchangedFiles,
        toUploadFiles: result.toUploadFiles,
        uploadedFiles: result.uploadedFiles,
      }).toEqual({
        totalFiles: paths.length,
        unchangedFiles: paths.filter((content) => had.has(content)).length,
        toUploadFiles: sent.size,
        uploadedFiles: sent.size,
      });
    }),
    { numRuns: 40 },
  );
}, 120_000);

it("never counts a file as unchanged on a site's first publish", async () => {
  await fc.assert(
    fc.asyncProperty(site, async (files) => {
      const result = await upload(files, new SiteStore({ bucket: env.bucket }), uniqueSite(), "p1");
      expect(result.unchangedFiles).toBe(0);
    }),
    { numRuns: 25 },
  );
}, 120_000);

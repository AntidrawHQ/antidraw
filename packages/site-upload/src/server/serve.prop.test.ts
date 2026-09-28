import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clashes, sitePath } from "../../test/arbitraries";
import { bytes, manifestOf, sha256, startTestWorker, uniqueSite, type TestWorker } from "../../test/helpers";
import { SiteServer } from "./serve";
import { SiteStore } from "./store";

let env: TestWorker;
beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

// How a link can name a file: every segment percent-encoded (what a careful
// page or our own links do), the same after macOS turns it into NFD, and
// written raw in an href, which the browser's URL parser encodes.
const encoded = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const REQUESTS: Record<string, (path: string) => string | null> = {
  encoded,
  "encoded NFD": (path) => encoded(path.normalize("NFD")),
  // A raw ?, # or % in an href means something else to a browser, and the URL parser trims a
  // trailing space, so a page must encode those itself. "./" stops a first segment like
  // "a:b" reading as a URL scheme.
  "raw href": (path) =>
    /[?#%]| $/.test(path) ? null : new URL(`./${path}`, "https://site.test/").pathname,
};

describe("SiteServer properties", () => {
  it("serves every path parseManifest accepts, however the link spells it", { timeout: 120_000 }, async () => {
    const store = new SiteStore({ bucket: env.bucket });
    const paths = fc
      .uniqueArray(sitePath, { minLength: 1, maxLength: 6 })
      .filter((ps) => !clashes(ps));
    let publishes = 0;
    await fc.assert(
      fc.asyncProperty(paths, async (ps) => {
        const site = uniqueSite("prop");
        // Each file's content is its own path, so a wrong file shows up as wrong bytes.
        const contents = Object.fromEntries(ps.map((p) => [p, `file ${p}`]));
        const { missing } = await store.plan(site, `p${++publishes}`, manifestOf(contents));
        for (const content of Object.values(contents)) {
          if (!missing.includes(sha256(content))) continue;
          const body = bytes(content);
          await store.putFile(site, `p${publishes}`, sha256(content), body, body.length);
        }
        await store.commit(site, `p${publishes}`);

        const server = new SiteServer({ store });
        const failures: string[] = [];
        for (const path of ps) {
          for (const [how, spell] of Object.entries(REQUESTS)) {
            const pathname = spell(path);
            if (pathname === null) continue;
            const url = `https://site.test/${pathname.replace(/^\//, "")}`;
            const res = await server.fetch(new Request(url), site);
            const body = await res.text();
            if (res.status !== 200 || body !== contents[path]) {
              failures.push(`${JSON.stringify(path)} as ${how} ${url} → ${res.status} ${JSON.stringify(body.slice(0, 40))}`);
            }
          }
        }
        expect(failures).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});

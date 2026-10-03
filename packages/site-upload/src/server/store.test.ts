import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bytes,
  startTestWorker,
  keysUnder,
  manifestOf,
  readable,
  sha256,
  thrown,
  uniqueSite,
  type TestWorker,
} from "../../test/helpers";
import { SiteStore } from "./store";

const HOUR = 60 * 60 * 1000;

let env: TestWorker;
let clock: number;
let store: SiteStore;
let site: string;

beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

beforeEach(() => {
  clock = Date.now();
  store = new SiteStore({ bucket: env.bucket, now: () => clock });
  site = uniqueSite();
});

/** Everything stored for the site, relative to its root. */
const stored = () => keysUnder(env.bucket, `sites/${site}/`);

async function upload(publishId: string, contents: Record<string, string>, immutable: string[] = []) {
  const { missing } = await store.plan(site, publishId, manifestOf(contents, immutable));
  const pending = [...new Set(Object.values(contents))].filter((content) => missing.includes(sha256(content)));
  // In batches, so the 1,100-file test stays well inside its timeout.
  for (let i = 0; i < pending.length; i += 50) {
    await Promise.all(
      pending.slice(i, i + 50).map((content) => {
        const body = bytes(content);
        return store.putFile(site, publishId, sha256(content), body, body.length);
      }),
    );
  }
}

/** Uploads a publish and checks it's complete, as a caller does before recording it live. */
async function publish(publishId: string, contents: Record<string, string>, immutable: string[] = []) {
  await upload(publishId, contents, immutable);
  await store.requireComplete(site, publishId);
}

const plan = async (publishId: string, contents: Record<string, string>) =>
  readable(await store.plan(site, publishId, manifestOf(contents)));

describe("plan", () => {
  it("lists every unique hash on the first publish, and records the plan", async () => {
    expect(await plan("p1", { "index.html": "<h1>", "a.txt": "same", "b.txt": "same" })).toMatchInlineSnapshot(`
      {
        "missing": [
          "sha(same)",
          "sha(<h1>)",
        ],
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "m/p1.json",
      ]
    `);
  });

  it("lists only what the site doesn't have", async () => {
    await publish("p1", { "index.html": "v1", "logo.png": "logo" });
    expect(await plan("p2", { "index.html": "v2", "logo.png": "logo" })).toMatchInlineSnapshot(`
      {
        "missing": [
          "sha(v2)",
        ],
      }
    `);
  });

  it("doesn't share files between sites", async () => {
    await publish("p1", { "index.html": "shared" });
    site = uniqueSite("other");
    expect(await plan("p1", { "index.html": "shared" })).toMatchInlineSnapshot(`
      {
        "missing": [
          "sha(shared)",
        ],
      }
    `);
  });

  it("can be repeated with the same manifest", async () => {
    await plan("p1", { "index.html": "x" });
    expect(await plan("p1", { "index.html": "x" })).toMatchInlineSnapshot(`
      {
        "missing": [
          "sha(x)",
        ],
      }
    `);
  });

  it("can be repeated however long after, but not with different files", async () => {
    await publish("p1", { "index.html": "x" });
    clock += 30 * 24 * HOUR;
    expect({
      same: await plan("p1", { "index.html": "x" }),
      different: await thrown(plan("p1", { "index.html": "changed" })),
    }).toMatchInlineSnapshot(`
      {
        "different": {
          "code": "PLAN_EXISTS",
          "error": "SiteUploadError",
          "message": "Publish p1 already has a different file list",
        },
        "same": {
          "missing": [],
        },
      }
    `);
  });

  it("deletes nothing, even what an abandoned publish left long ago", async () => {
    await upload("abandoned", { "index.html": "never committed", "a.js": "reused" });
    clock += 2 * HOUR;
    const result = await plan("p2", { "index.html": "new", "a.js": "reused" });
    expect({ result, stored: await stored() }).toMatchInlineSnapshot(`
      {
        "result": {
          "missing": [
            "sha(new)",
          ],
        },
        "stored": [
          "f/sha(never committed)",
          "f/sha(reused)",
          "m/abandoned.json",
          "m/p2.json",
        ],
      }
    `);
  });

  it("refuses conflicting and invalid plans", async () => {
    await plan("p1", { "index.html": "x" });
    await publish("p2", { "index.html": "y" });
    const small = new SiteStore({ bucket: env.bucket, limits: { maxFiles: 1 } });
    const results = {
      "different manifest, same publish": await thrown(plan("p1", { "index.html": "changed" })),
      "different manifest, completed publish": await thrown(plan("p2", { "index.html": "changed" })),
      "bad site": await thrown(store.plan("../x", "p1", manifestOf({ a: "x" }))),
      "bad publish id": await thrown(store.plan(site, "a/b", manifestOf({ a: "x" }))),
      "empty manifest": await thrown(store.plan(site, "p3", { v: 1, files: {} })),
      "over a limit": await thrown(small.plan(site, "p3", manifestOf({ a: "1", b: "2" }))),
    };
    expect(results).toMatchInlineSnapshot(`
      {
        "bad publish id": {
          "code": "INVALID_REQUEST",
          "error": "SiteUploadError",
          "message": "Invalid publishId: use 1-128 letters, digits, _ or -",
        },
        "bad site": {
          "code": "INVALID_REQUEST",
          "error": "SiteUploadError",
          "message": "Invalid site: use 1-128 letters, digits, _ or -",
        },
        "different manifest, completed publish": {
          "code": "PLAN_EXISTS",
          "error": "SiteUploadError",
          "message": "Publish p2 already has a different file list",
        },
        "different manifest, same publish": {
          "code": "PLAN_EXISTS",
          "error": "SiteUploadError",
          "message": "Publish p1 already has a different file list",
        },
        "empty manifest": {
          "code": "INVALID_MANIFEST",
          "error": "SiteUploadError",
          "message": "Manifest has no files",
        },
        "over a limit": {
          "code": "TOO_LARGE",
          "details": {
            "actual": 2,
            "limit": 1,
            "reason": "files",
          },
          "error": "SiteUploadError",
          "message": "2 files is over the 1-file limit",
        },
      }
    `);
  });
});

describe("putFile", () => {
  beforeEach(() => plan("p1", { "index.html": "hello", "empty.txt": "" }));

  it("stores bytes that match the hash, and an empty file", async () => {
    await store.putFile(site, "p1", sha256("hello"), bytes("hello"), 5);
    await store.putFile(site, "p1", sha256(""), null, 0);
    expect(await (await store.getFile(site, sha256("hello")))?.text()).toBe("hello");
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "f/sha(hello)",
        "f/sha()",
        "m/p1.json",
      ]
    `);
  });

  it("can repeat an upload", async () => {
    await store.putFile(site, "p1", sha256("hello"), bytes("hello"), 5);
    await store.putFile(site, "p1", sha256("hello"), bytes("hello"), 5);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "f/sha(hello)",
        "m/p1.json",
      ]
    `);
  });

  it("refuses bad uploads and stores nothing for them", async () => {
    const put = (publishId: string, hash: string, body: string, length: number | null) =>
      thrown(store.putFile(site, publishId, hash, bytes(body), length));
    const results = {
      "wrong bytes": await put("p1", sha256("hello"), "HELLO", 5),
      "hash not in plan": await put("p1", sha256("other"), "other", 5),
      "no length": await put("p1", sha256("hello"), "hello", null),
      "wrong length": await put("p1", sha256("hello"), "hello!", 6),
      "unknown publish": await put("nope", sha256("hello"), "hello", 5),
      "malformed hash": await put("p1", "../current.json", "x", 1),
    };
    expect(results).toMatchInlineSnapshot(`
      {
        "hash not in plan": {
          "code": "NOT_IN_PLAN",
          "details": {
            "hash": "sha(other)",
          },
          "error": "SiteUploadError",
          "message": "sha(other) is not part of publish p1",
        },
        "malformed hash": {
          "code": "INVALID_REQUEST",
          "error": "SiteUploadError",
          "message": "The file hash must be a lowercase sha256 hex digest",
        },
        "no length": {
          "code": "LENGTH_REQUIRED",
          "error": "SiteUploadError",
          "message": "A Content-Length header is required",
        },
        "unknown publish": {
          "code": "NO_PLAN",
          "error": "SiteUploadError",
          "message": "No plan was recorded for publish nope",
        },
        "wrong bytes": {
          "code": "HASH_MISMATCH",
          "details": {
            "hash": "sha(hello)",
          },
          "error": "SiteUploadError",
          "message": "The bytes sent don't hash to sha(hello)",
        },
        "wrong length": {
          "code": "SIZE_MISMATCH",
          "details": {
            "actual": 6,
            "expected": 5,
            "hash": "sha(hello)",
          },
          "error": "SiteUploadError",
          "message": "sha(hello) is 5 bytes in the plan but 6 bytes were sent",
        },
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "m/p1.json",
      ]
    `);
  });
});

describe("requireComplete", () => {
  it("passes once every file of the plan is stored, and changes nothing", async () => {
    await upload("p1", { "index.html": "v1", "a/b.txt": "b" });
    const before = await stored();
    await store.requireComplete(site, "p1");
    expect(await stored()).toEqual(before);
  });

  it("refuses while files are missing, naming them", async () => {
    await store.plan(site, "p1", manifestOf({ "index.html": "a", "b.txt": "b", "c.txt": "c" }));
    await store.putFile(site, "p1", sha256("a"), bytes("a"), 1);
    expect(await thrown(store.requireComplete(site, "p1"))).toMatchInlineSnapshot(`
      {
        "code": "MISSING_FILES",
        "details": {
          "missing": [
            "sha(c)",
            "sha(b)",
          ],
        },
        "error": "SiteUploadError",
        "message": "2 files are not uploaded yet",
      }
    `);
  });

  it("refuses a publish that never planned", async () => {
    expect(await thrown(store.requireComplete(site, "p1"))).toMatchInlineSnapshot(`
      {
        "code": "NO_PLAN",
        "error": "SiteUploadError",
        "message": "No plan was recorded for publish p1",
      }
    `);
  });

  it("accepts files another publish of the same site uploaded", async () => {
    await upload("p1", { "index.html": "shared" });
    await store.plan(site, "p2", manifestOf({ "index.html": "shared" }));
    await store.requireComplete(site, "p2");
  });

  it("passes for overlapping publishes in any order: which goes live is the caller's", async () => {
    await upload("p1", { "index.html": "v1" });
    await upload("p2", { "index.html": "v2" });
    await Promise.all([store.requireComplete(site, "p2"), store.requireComplete(site, "p1")]);
  });
});

describe("readManifest", () => {
  it("returns a publish's files and the manifest's stored size", async () => {
    await publish("p1", { "index.html": "v1" });
    const manifest = await store.readManifest(site, "p1");
    expect({ ...readable(manifest), bytes: manifest!.bytes > 0 }).toMatchInlineSnapshot(`
      {
        "bytes": true,
        "files": {
          "index.html": {
            "h": "sha(v1)",
            "s": 2,
          },
        },
      }
    `);
  });

  it("returns null for a publish that never planned", async () => {
    expect(await store.readManifest(site, "nope")).toBeNull();
  });

  it("fails loudly on a corrupt manifest", async () => {
    const key = `sites/${site}/m/p1.json`;
    await env.bucket.put(key, "{not json");
    const notJson = await thrown(store.readManifest(site, "p1"));
    await env.bucket.put(key, JSON.stringify({ v: 1, files: {} }));
    const incomplete = await thrown(store.readManifest(site, "p1"));
    await env.bucket.put(key, JSON.stringify({ v: 1, publishId: "p1", createdAt: 1, files: { "../x": { h: "x", s: 1 } } }));
    const badFiles = await thrown(store.readManifest(site, "p1"));
    expect({ notJson, incomplete, badFiles }).toMatchInlineSnapshot(`
      {
        "badFiles": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The stored plan has an invalid file list",
        },
        "incomplete": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "A stored plan is malformed",
        },
        "notJson": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The stored plan is not valid JSON",
        },
      }
    `);
  });

  it("still reads a manifest written under larger limits", async () => {
    await publish("p1", { "index.html": "x", "b.txt": "y" });
    const strict = new SiteStore({ bucket: env.bucket, limits: { maxFiles: 1 } });
    expect(Object.keys((await strict.readManifest(site, "p1"))!.files)).toHaveLength(2);
  });
});

describe("cleanup", () => {
  it("keeps the publishes asked for and their files, deletes the rest", async () => {
    await publish("p1", { "index.html": "v1", "assets/app-1.js": "js1", "logo.png": "logo" }, ["assets/app-1.js"]);
    await publish("p2", { "index.html": "v2", "assets/app-2.js": "js2", "logo.png": "logo" }, ["assets/app-2.js"]);
    await publish("p3", { "index.html": "v3", "assets/app-3.js": "js3", "logo.png": "logo" }, ["assets/app-3.js"]);
    clock += 2 * HOUR;
    // Live and previous, as the caller's records name them.
    expect(await store.cleanup(site, { keep: ["p3", "p2"] })).toMatchInlineSnapshot(`
      {
        "deletedFiles": 2,
        "deletedPlans": 1,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "f/sha(logo)",
        "f/sha(js3)",
        "f/sha(js2)",
        "f/sha(v3)",
        "f/sha(v2)",
        "m/p2.json",
        "m/p3.json",
      ]
    `);
  });

  it("keeps everything younger than the grace period, kept or not", async () => {
    await publish("p1", { "index.html": "v1" });
    await publish("p2", { "index.html": "v2" });
    const early = await store.cleanup(site, { keep: ["p2"] });
    clock += 2 * HOUR;
    expect({ early, late: await store.cleanup(site, { keep: ["p2"] }), after: await stored() }).toMatchInlineSnapshot(`
      {
        "after": [
          "f/sha(v2)",
          "m/p2.json",
        ],
        "early": {
          "deletedFiles": 0,
          "deletedPlans": 0,
        },
        "late": {
          "deletedFiles": 1,
          "deletedPlans": 1,
        },
      }
    `);
  });

  it("keeps the files of a recent plan that reuses an old file", async () => {
    await publish("p1", { "index.html": "v1" });
    await publish("p2", { "index.html": "v2" });
    clock += 2 * HOUR;
    // p3 reuses v1's file, which only the stale p1 needed, and it is past the grace period.
    await plan("p3", { "index.html": "v1" });
    clock += HOUR / 2;
    expect({ result: await store.cleanup(site, { keep: ["p2"] }), after: await stored() }).toMatchInlineSnapshot(`
      {
        "after": [
          "f/sha(v1)",
          "f/sha(v2)",
          "m/p2.json",
          "m/p3.json",
        ],
        "result": {
          "deletedFiles": 0,
          "deletedPlans": 1,
        },
      }
    `);
    await store.requireComplete(site, "p3");
  });

  it("deletes stray files nothing references once they are old", async () => {
    await publish("p1", { "index.html": "v1" });
    await env.bucket.put(`sites/${site}/f/${sha256("stray")}`, "stray");
    const early = await store.cleanup(site, { keep: ["p1"] });
    clock += 2 * HOUR;
    expect({ early, late: await store.cleanup(site, { keep: ["p1"] }) }).toMatchInlineSnapshot(`
      {
        "early": {
          "deletedFiles": 0,
          "deletedPlans": 0,
        },
        "late": {
          "deletedFiles": 1,
          "deletedPlans": 0,
        },
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "f/sha(v1)",
        "m/p1.json",
      ]
    `);
  });

  it("stops rather than guess when a recent plan can't be read, and deletes it once old", async () => {
    await publish("p1", { "index.html": "v1" });
    await env.bucket.put(`sites/${site}/m/broken.json`, "{");
    const fresh = await thrown(store.cleanup(site, { keep: ["p1"] }));
    const unchanged = await stored();
    clock += 2 * HOUR;
    expect({ fresh, unchanged, old: await store.cleanup(site, { keep: ["p1"] }) }).toMatchInlineSnapshot(`
      {
        "fresh": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The stored plan is not valid JSON",
        },
        "old": {
          "deletedFiles": 0,
          "deletedPlans": 1,
        },
        "unchanged": [
          "f/sha(v1)",
          "m/broken.json",
          "m/p1.json",
        ],
      }
    `);
  });

  it("aborts, deleting nothing, when reading a kept plan fails", async () => {
    await publish("p1", { "index.html": "v1" });
    await publish("p2", { "index.html": "v2" });
    clock += 2 * HOUR;
    const before = await stored();
    const bucket = env.bucket;
    const flaky = new SiteStore({
      now: () => clock,
      bucket: {
        list: bucket.list.bind(bucket),
        put: bucket.put.bind(bucket),
        delete: bucket.delete.bind(bucket),
        get: async (key, options) => {
          if (key.endsWith("/m/p2.json")) throw new Error("R2 hiccup");
          return bucket.get(key, options);
        },
      },
    });
    const error = await thrown(flaky.cleanup(site, { keep: ["p2"] }));
    expect({ error, deletedNothing: JSON.stringify(await stored()) === JSON.stringify(before) }).toMatchInlineSnapshot(`
      {
        "deletedNothing": true,
        "error": {
          "error": "Error",
          "message": "R2 hiccup",
        },
      }
    `);
  });

  it("deletes old plans without reading them", async () => {
    await publish("p1", { "index.html": "v1" });
    await Promise.all(Array.from({ length: 200 }, (_, i) => env.bucket.put(`sites/${site}/m/old-${i}.json`, "{")));
    clock += 2 * HOUR;
    let planReads = 0;
    const bucket = env.bucket;
    const counting = new SiteStore({
      now: () => clock,
      bucket: {
        list: bucket.list.bind(bucket),
        put: bucket.put.bind(bucket),
        delete: bucket.delete.bind(bucket),
        get: (key, options) => {
          if (key.includes("/m/old-")) planReads++;
          return bucket.get(key, options);
        },
      },
    });
    expect({ result: await counting.cleanup(site, { keep: ["p1"] }), planReads }).toMatchInlineSnapshot(`
      {
        "planReads": 0,
        "result": {
          "deletedFiles": 0,
          "deletedPlans": 200,
        },
      }
    `);
  });

  it("deletes everything old when nothing is kept", async () => {
    await upload("p1", { "index.html": "v1" });
    clock += 2 * HOUR;
    expect({ result: await store.cleanup(site, { keep: [] }), after: await stored() }).toMatchInlineSnapshot(`
      {
        "after": [],
        "result": {
          "deletedFiles": 1,
          "deletedPlans": 1,
        },
      }
    `);
  });

  it("pages through more than 1000 files", { timeout: 120_000 }, async () => {
    const contents: Record<string, string> = {};
    for (let i = 0; i < 1100; i++) contents[`f/${i}.txt`] = `file ${i}`;
    await publish("p1", contents);
    await publish("p2", { "index.html": "v2" });
    await publish("p3", { "index.html": "v3" });
    clock += 2 * HOUR;
    expect(await store.cleanup(site, { keep: ["p3"] })).toMatchInlineSnapshot(`
      {
        "deletedFiles": 1101,
        "deletedPlans": 2,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "f/sha(v3)",
        "m/p3.json",
      ]
    `);
  });
});

describe("deleteSite", () => {
  it("removes every object of the site and nothing else", async () => {
    await publish("p1", { "index.html": "v1" });
    const deleted = site;
    site = uniqueSite("keep");
    await plan("p1", { "index.html": "x" });

    expect(await store.deleteSite(deleted)).toMatchInlineSnapshot(`2`);
    expect(await keysUnder(env.bucket, `sites/${deleted}/`)).toEqual([]);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "m/p1.json",
      ]
    `);
  });
});

describe("options", () => {
  it("uses a custom key prefix", async () => {
    const prefixed = new SiteStore({ bucket: env.bucket, prefix: "tenant/a" });
    await prefixed.plan(site, "p1", manifestOf({ "index.html": "x" }));
    expect(await keysUnder(env.bucket, `tenant/a/${site}/`)).toMatchInlineSnapshot(`
      [
        "m/p1.json",
      ]
    `);
  });

  it("rejects prefixes that could escape their folder", () => {
    const prefixes = ["", "/a", "a/", "a//b", "../a", "a b", "a.b"];
    const accepted = prefixes.filter((prefix) => {
      try {
        new SiteStore({ bucket: env.bucket, prefix });
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([]);
  });
});

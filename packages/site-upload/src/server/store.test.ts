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
let startClock: number;
let store: SiteStore;
let site: string;

beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

beforeEach(() => {
  clock = startClock = Date.now();
  store = new SiteStore({ bucket: env.bucket, now: () => clock });
  site = uniqueSite();
});

/** Everything stored for the site, relative to its root. */
const stored = () => keysUnder(env.bucket, `sites/${site}/`);

/** The live pointer, with committedAt shown relative to the test's start. */
async function pointer() {
  const value = await store.readPointer(site);
  if (!value) return null;
  return readable({ ...value, committedAt: `start+${(value.committedAt - startClock) / HOUR}h` });
}

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

async function publish(publishId: string, contents: Record<string, string>, immutable: string[] = []) {
  await upload(publishId, contents, immutable);
  return store.commit(site, publishId);
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

  it("re-plans the live publish even after its plan's upload window closed", async () => {
    await publish("p1", { "index.html": "x" });
    clock += 2 * HOUR;
    // Without the live-publish shortcut this would be PLAN_EXPIRED: the stored plan is past its window.
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

  it("clears publishes that were uploaded but never committed when recording a new one", async () => {
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
          "f/sha(reused)",
          "m/p2.json",
        ],
      }
    `);
  });

  it("refuses conflicting, expired and invalid plans", async () => {
    await plan("p1", { "index.html": "x" });
    await publish("p2", { "index.html": "y" });
    const small = new SiteStore({ bucket: env.bucket, limits: { maxFiles: 1 } });
    const results = {
      "different manifest, same publish": await thrown(plan("p1", { "index.html": "changed" })),
      "different manifest, committed publish": await thrown(plan("p2", { "index.html": "changed" })),
      "bad site": await thrown(store.plan("../x", "p1", manifestOf({ a: "x" }))),
      "bad publish id": await thrown(store.plan(site, "a/b", manifestOf({ a: "x" }))),
      "empty manifest": await thrown(store.plan(site, "p3", { v: 1, files: {} })),
      "over a limit": await thrown(small.plan(site, "p3", manifestOf({ a: "1", b: "2" }))),
    };
    clock += HOUR;
    const expired = await thrown(plan("p1", { "index.html": "x" }));
    expect({ ...results, expired }).toMatchInlineSnapshot(`
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
        "different manifest, committed publish": {
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
        "expired": {
          "code": "PLAN_EXPIRED",
          "error": "SiteUploadError",
          "message": "Publish p1 took too long; start a new one",
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
    clock += HOUR;
    const expired = await put("p1", sha256("hello"), "hello", 5);
    expect({ ...results, expired }).toMatchInlineSnapshot(`
      {
        "expired": {
          "code": "PLAN_EXPIRED",
          "error": "SiteUploadError",
          "message": "Publish p1 took too long; start a new one",
        },
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

describe("commit", () => {
  it("makes the plan live and reports it", async () => {
    clock += HOUR / 2;
    expect(await publish("p1", { "index.html": "v1", "a/b.txt": "b" })).toMatchInlineSnapshot(`
      {
        "alreadyCommitted": false,
        "previous": null,
        "publishId": "p1",
      }
    `);
    expect(await pointer()).toMatchInlineSnapshot(`
      {
        "committedAt": "start+0.5h",
        "files": {
          "a/b.txt": {
            "h": "sha(b)",
            "s": 1,
          },
          "index.html": {
            "h": "sha(v1)",
            "s": 2,
          },
        },
        "previous": null,
        "publishId": "p1",
        "retained": {},
        "seq": 1,
        "v": 1,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "current.json",
        "f/sha(v1)",
        "f/sha(b)",
        "m/p1.json",
      ]
    `);
  });

  it("records the previous version, and can be repeated", async () => {
    await publish("p1", { "index.html": "v1" });
    expect({
      second: await publish("p2", { "index.html": "v2" }),
      repeated: await store.commit(site, "p2"),
      pointer: await pointer(),
    }).toMatchInlineSnapshot(`
      {
        "pointer": {
          "committedAt": "start+0h",
          "files": {
            "index.html": {
              "h": "sha(v2)",
              "s": 2,
            },
          },
          "previous": "p1",
          "publishId": "p2",
          "retained": {},
          "seq": 2,
          "v": 1,
        },
        "repeated": {
          "alreadyCommitted": true,
          "previous": "p1",
          "publishId": "p2",
        },
        "second": {
          "alreadyCommitted": false,
          "previous": "p1",
          "publishId": "p2",
        },
      }
    `);
  });

  it("refuses while files are missing, naming them, and changes nothing", async () => {
    await store.plan(site, "p1", manifestOf({ "index.html": "a", "b.txt": "b", "c.txt": "c" }));
    await store.putFile(site, "p1", sha256("a"), bytes("a"), 1);
    expect(await thrown(store.commit(site, "p1"))).toMatchInlineSnapshot(`
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
    expect(await pointer()).toBeNull();
  });

  it("refuses without a plan or after it expired", async () => {
    const noPlan = await thrown(store.commit(site, "p1"));
    await upload("p1", { "index.html": "x" });
    clock += HOUR;
    expect({ noPlan, expired: await thrown(store.commit(site, "p1")) }).toMatchInlineSnapshot(`
      {
        "expired": {
          "code": "PLAN_EXPIRED",
          "error": "SiteUploadError",
          "message": "Publish p1 took too long; start a new one",
        },
        "noPlan": {
          "code": "NO_PLAN",
          "error": "SiteUploadError",
          "message": "No plan was recorded for publish p1",
        },
      }
    `);
  });

  it("refuses if another commit swapped the pointer in between", async () => {
    await publish("p1", { "index.html": "v1" });
    await upload("p2", { "index.html": "v2" });
    await upload("p3", { "index.html": "v3" });

    // p2's commit reads the pointer, then p3's commit lands before p2 writes.
    const bucket = env.bucket;
    const racing = new SiteStore({
      now: () => clock,
      bucket: {
        get: bucket.get.bind(bucket),
        list: bucket.list.bind(bucket),
        delete: bucket.delete.bind(bucket),
        put: async (key, value, options) => {
          if (key.endsWith("current.json")) await store.commit(site, "p3");
          return bucket.put(key, value, options);
        },
      },
    });
    expect(await thrown(racing.commit(site, "p2"))).toMatchInlineSnapshot(`
      {
        "code": "CONFLICT",
        "error": "SiteUploadError",
        "message": "Another publish of this site committed first",
      }
    `);
    expect((await pointer())?.publishId).toBe("p3");
  });

  it("accepts files another publish of the same site uploaded", async () => {
    await upload("p1", { "index.html": "shared" });
    await store.plan(site, "p2", manifestOf({ "index.html": "shared" }));
    expect(await store.commit(site, "p2")).toMatchInlineSnapshot(`
      {
        "alreadyCommitted": false,
        "previous": null,
        "publishId": "p2",
      }
    `);
  });
});

describe("commit retries", () => {
  it("refuses a replayed commit once a newer publish went live", async () => {
    await upload("a", { "index.html": "a" });
    clock += 1000;
    await store.commit(site, "a");
    clock += 1000;
    await upload("b", { "index.html": "b" });
    clock += 1000;
    await store.commit(site, "b");
    // a's first commit went through but its reply was lost; the client retries now.
    expect({ replay: await thrown(store.commit(site, "a")), live: (await pointer())?.publishId }).toMatchInlineSnapshot(`
      {
        "live": "b",
        "replay": {
          "code": "SUPERSEDED",
          "details": {
            "live": "b",
          },
          "error": "SiteUploadError",
          "message": "Publish b went live after a was planned",
        },
      }
    `);
  });

  it("orders commits by count, not time: nothing rolls back even within one millisecond", async () => {
    // The clock never moves, so every plan and commit shares a timestamp.
    await upload("p3", { "index.html": "three" });
    await store.commit(site, "p3");
    await upload("p4", { "index.html": "four" });
    await store.commit(site, "p4");
    expect({ replayOfP3: await thrown(store.commit(site, "p3")), live: (await pointer())?.publishId }).toMatchInlineSnapshot(`
      {
        "live": "p4",
        "replayOfP3": {
          "code": "SUPERSEDED",
          "details": {
            "live": "p4",
          },
          "error": "SiteUploadError",
          "message": "Publish p4 went live after p3 was planned",
        },
      }
    `);
  });

  it("lets a publish planned on a machine whose clock runs behind go live", async () => {
    const ahead = new SiteStore({ bucket: env.bucket, now: () => clock + 10_000 });
    await ahead.plan(site, "p1", manifestOf({ "index.html": "one" }));
    await ahead.putFile(site, "p1", sha256("one"), bytes("one"), 3);
    await ahead.commit(site, "p1");
    // Planned after p1 went live, but stamped 10 s earlier by a slower clock.
    const behind = new SiteStore({ bucket: env.bucket, now: () => clock });
    await behind.plan(site, "p2", manifestOf({ "index.html": "two" }));
    await behind.putFile(site, "p2", sha256("two"), bytes("two"), 3);
    expect(await behind.commit(site, "p2")).toMatchInlineSnapshot(`
      {
        "alreadyCommitted": false,
        "previous": "p1",
        "publishId": "p2",
      }
    `);
  });

  it("reports a commit that lost the race to its own retry as committed", async () => {
    await publish("p1", { "index.html": "v1" });
    await upload("p2", { "index.html": "v2" });
    const bucket = env.bucket;
    const racing = new SiteStore({
      now: () => clock,
      bucket: {
        get: bucket.get.bind(bucket),
        list: bucket.list.bind(bucket),
        delete: bucket.delete.bind(bucket),
        put: async (key, value, options) => {
          // The same publish's other attempt lands between this one's read and write.
          if (key.endsWith("current.json")) await store.commit(site, "p2");
          return bucket.put(key, value, options);
        },
      },
    });
    expect({ result: await racing.commit(site, "p2"), live: (await pointer())?.publishId }).toMatchInlineSnapshot(`
      {
        "live": "p2",
        "result": {
          "alreadyCommitted": true,
          "previous": "p1",
          "publishId": "p2",
        },
      }
    `);
  });
});

describe("retained files", () => {
  it("keeps the previous version's hashed chunks that the new version dropped", async () => {
    await publish("p1", { "index.html": "v1", "assets/app-1.js": "js1", "assets/shared.js": "shared", "about.txt": "a" }, [
      "assets/app-1.js",
      "assets/shared.js",
    ]);
    await publish("p2", { "index.html": "v2", "assets/app-2.js": "js2", "assets/shared.js": "shared" }, [
      "assets/app-2.js",
      "assets/shared.js",
    ]);
    const second = (await pointer())?.retained;
    await publish("p3", { "index.html": "v3", "assets/app-3.js": "js3" }, ["assets/app-3.js"]);
    // Only one version back: app-1.js is no longer retained.
    expect({ afterSecond: second, afterThird: (await pointer())?.retained }).toMatchInlineSnapshot(`
      {
        "afterSecond": {
          "assets/app-1.js": {
            "h": "sha(js1)",
            "i": true,
            "s": 3,
          },
        },
        "afterThird": {
          "assets/app-2.js": {
            "h": "sha(js2)",
            "i": true,
            "s": 3,
          },
          "assets/shared.js": {
            "h": "sha(shared)",
            "i": true,
            "s": 6,
          },
        },
      }
    `);
  });
});

describe("retained documents", () => {
  it("never carries the previous version's pages or SVG forward, even when marked immutable", async () => {
    await publish(
      "p1",
      { "index.html": "v1", "old.html": "old page", "icon.svg": "<svg/>", "assets/app-1.js": "js1" },
      ["old.html", "icon.svg", "assets/app-1.js"],
    );
    await publish("p2", { "index.html": "v2" });
    expect((await pointer())?.retained).toMatchInlineSnapshot(`
      {
        "assets/app-1.js": {
          "h": "sha(js1)",
          "i": true,
          "s": 3,
        },
      }
    `);
  });
});

describe("readPointer", () => {
  it("returns null for a site that was never published", async () => {
    expect(await store.readPointer(site)).toBeNull();
  });

  it("fails loudly on a corrupt pointer", async () => {
    await env.bucket.put(`sites/${site}/current.json`, "{not json");
    const notJson = await thrown(store.readPointer(site));
    await env.bucket.put(`sites/${site}/current.json`, JSON.stringify({ v: 1, publishId: "p1", files: {} }));
    const incomplete = await thrown(store.readPointer(site));
    await env.bucket.put(
      `sites/${site}/current.json`,
      JSON.stringify({ v: 1, seq: 1, publishId: "p1", previous: null, committedAt: 1, files: { "../x": { h: "x", s: 1 } } }),
    );
    const badFiles = await thrown(store.readPointer(site));
    expect({ notJson, incomplete, badFiles }).toMatchInlineSnapshot(`
      {
        "badFiles": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The stored pointer has an invalid file list",
        },
        "incomplete": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The site pointer is malformed",
        },
        "notJson": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The stored pointer is not valid JSON",
        },
      }
    `);
  });

  it("still reads a pointer written under larger limits", async () => {
    await publish("p1", { "index.html": "x", "b.txt": "y" });
    const strict = new SiteStore({ bucket: env.bucket, limits: { maxFiles: 1 } });
    expect((await strict.readPointer(site))?.publishId).toBe("p1");
  });
});

describe("cleanup", () => {
  it("keeps the live version and its retained chunks, deletes the rest", async () => {
    await publish("p1", { "index.html": "v1", "assets/app-1.js": "js1", "logo.png": "logo" }, ["assets/app-1.js"]);
    await publish("p2", { "index.html": "v2", "assets/app-2.js": "js2", "logo.png": "logo" }, ["assets/app-2.js"]);
    await publish("p3", { "index.html": "v3", "assets/app-3.js": "js3", "logo.png": "logo" }, ["assets/app-3.js"]);
    clock += 2 * HOUR;
    expect(await store.cleanup(site)).toMatchInlineSnapshot(`
      {
        "deletedFiles": 3,
        "deletedPlans": 2,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "current.json",
        "f/sha(logo)",
        "f/sha(js3)",
        "f/sha(js2)",
        "f/sha(v3)",
        "m/p3.json",
      ]
    `);
  });

  it("keeps unreferenced files for the grace period, even once their plans expired", async () => {
    // Plans dated two hours ago (so expired), but R2 records the files as uploaded just now.
    clock = Date.now() - 2 * HOUR;
    await publish("p1", { "index.html": "v1" });
    await publish("p2", { "index.html": "v2" });
    clock = Date.now();
    const early = await store.cleanup(site);
    const keptByGrace = await stored();
    // Past the grace period, nothing protects v1 any more.
    clock = Date.now() + 2 * HOUR;
    expect({ early, keptByGrace, late: await store.cleanup(site), after: await stored() }).toMatchInlineSnapshot(`
      {
        "after": [
          "current.json",
          "f/sha(v2)",
          "m/p2.json",
        ],
        "early": {
          "deletedFiles": 0,
          "deletedPlans": 1,
        },
        "keptByGrace": [
          "current.json",
          "f/sha(v1)",
          "f/sha(v2)",
          "m/p2.json",
        ],
        "late": {
          "deletedFiles": 1,
          "deletedPlans": 0,
        },
      }
    `);
  });

  it("keeps files of a publish still in progress", async () => {
    await publish("p1", { "index.html": "v1" });
    await publish("p2", { "index.html": "v2" });
    await publish("p3", { "index.html": "v3" });
    clock += 2 * HOUR;
    // p4 reuses v1's file, which neither p3 nor p2 needs, and it is past the grace period.
    // Recording p4 already ran cleanup, which kept v1 for p4 and deleted the rest.
    await plan("p4", { "index.html": "v1" });
    clock += HOUR / 2;
    expect(await store.cleanup(site)).toMatchInlineSnapshot(`
      {
        "deletedFiles": 0,
        "deletedPlans": 0,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "current.json",
        "f/sha(v1)",
        "f/sha(v3)",
        "m/p3.json",
        "m/p4.json",
      ]
    `);
    expect(await store.commit(site, "p4")).toMatchInlineSnapshot(`
      {
        "alreadyCommitted": false,
        "previous": "p3",
        "publishId": "p4",
      }
    `);
  });

  it("deletes expired plans and the files only they needed", async () => {
    await publish("p1", { "index.html": "v1" });
    await upload("abandoned", { "index.html": "never-live", "big.bin": "junk" });
    clock += 2 * HOUR;
    expect(await store.cleanup(site)).toMatchInlineSnapshot(`
      {
        "deletedFiles": 2,
        "deletedPlans": 1,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "current.json",
        "f/sha(v1)",
        "m/p1.json",
      ]
    `);
  });

  it("deletes stray files nothing references once they are old", async () => {
    await publish("p1", { "index.html": "v1" });
    await env.bucket.put(`sites/${site}/f/${sha256("stray")}`, "stray");
    const early = await store.cleanup(site);
    clock += 2 * HOUR;
    expect({ early, late: await store.cleanup(site) }).toMatchInlineSnapshot(`
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
        "current.json",
        "f/sha(v1)",
        "m/p1.json",
      ]
    `);
  });

  it("stops rather than guess when a fresh plan can't be read, and deletes it once expired", async () => {
    await publish("p1", { "index.html": "v1" });
    await env.bucket.put(`sites/${site}/m/broken.json`, "{");
    const fresh = await thrown(store.cleanup(site));
    const unchanged = await stored();
    clock += 2 * HOUR;
    expect({ fresh, unchanged, expired: await store.cleanup(site) }).toMatchInlineSnapshot(`
      {
        "expired": {
          "deletedFiles": 0,
          "deletedPlans": 1,
        },
        "fresh": {
          "code": "INTERNAL",
          "error": "SiteUploadError",
          "message": "The stored plan is not valid JSON",
        },
        "unchanged": [
          "current.json",
          "f/sha(v1)",
          "m/broken.json",
          "m/p1.json",
        ],
      }
    `);
  });

  it("aborts, deleting nothing, when reading a plan in progress fails", async () => {
    await publish("p1", { "index.html": "v1" });
    await publish("p2", { "index.html": "v2" });
    clock += 2 * HOUR;
    await upload("p3", { "index.html": "v1" });
    const before = await stored();
    const bucket = env.bucket;
    const flaky = new SiteStore({
      now: () => clock,
      bucket: {
        list: bucket.list.bind(bucket),
        put: bucket.put.bind(bucket),
        delete: bucket.delete.bind(bucket),
        get: async (key, options) => {
          if (key.endsWith("/m/p3.json")) throw new Error("R2 hiccup");
          return bucket.get(key, options);
        },
      },
    });
    const error = await thrown(flaky.cleanup(site));
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

  it("deletes expired plans without reading them", async () => {
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
          if (key.includes("/m/")) planReads++;
          return bucket.get(key, options);
        },
      },
    });
    expect({ result: await counting.cleanup(site), planReads }).toMatchInlineSnapshot(`
      {
        "planReads": 0,
        "result": {
          "deletedFiles": 0,
          "deletedPlans": 200,
        },
      }
    `);
  });

  it("works on a site that was never committed", async () => {
    await upload("p1", { "index.html": "v1" });
    const early = await store.cleanup(site);
    clock += 2 * HOUR;
    expect({ early, late: await store.cleanup(site) }).toMatchInlineSnapshot(`
      {
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
    expect(await stored()).toMatchInlineSnapshot(`[]`);
  });

  it("pages through more than 1000 files", { timeout: 120_000 }, async () => {
    const contents: Record<string, string> = {};
    for (let i = 0; i < 1100; i++) contents[`f/${i}.txt`] = `file ${i}`;
    await publish("p1", contents);
    await publish("p2", { "index.html": "v2" });
    await publish("p3", { "index.html": "v3" });
    clock += 2 * HOUR;
    expect(await store.cleanup(site)).toMatchInlineSnapshot(`
      {
        "deletedFiles": 1101,
        "deletedPlans": 2,
      }
    `);
    expect(await stored()).toMatchInlineSnapshot(`
      [
        "current.json",
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

    expect(await store.deleteSite(deleted)).toMatchInlineSnapshot(`3`);
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

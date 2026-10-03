import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHttpTransport, uploadSite } from "@antidraw/site-upload/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "../test/harness";

// The publish flow end to end, against the real Worker with local D1 and R2:
// the app's upload client talks to these routes as it will in production.

let server: TestServer;
let dirs: string[] = [];
beforeAll(async () => {
  server = await startServer();
}, 60_000);
afterAll(async () => {
  await server?.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

type User = { userId: string; authorization: string };

const post = (user: User | null, path: string, body?: unknown) =>
  server.fetch(path, {
    method: "POST",
    headers: {
      ...(user && { authorization: user.authorization }),
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const createSite = async (user: User, title = "My Canvas") => {
  const res = await post(user, "/api/sites", { title });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; slug: string; url: string };
};

const startPublish = async (user: User, siteId: string) => {
  const res = await post(user, `/api/sites/${siteId}/publishes`);
  expect(res.status).toBe(201);
  return (await res.json()) as { publishId: string; uploadUrl: string };
};

const siteDir = async (files: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), "antidraw-site-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
};

const upload = (user: User, uploadUrl: string, dir: string) =>
  uploadSite({
    dir,
    transport: createHttpTransport({ baseUrl: uploadUrl, headers: { authorization: user.authorization } }),
    maxAttempts: 1,
  });

/** Every key stored for the site, relative to its root, files and plans by kind. */
const stored = async (siteId: string) => {
  const prefix = `sites/${siteId}/`;
  const { objects } = await server.env.SITES.list({ prefix });
  return objects.map((object) => object.key.slice(prefix.length).replace(/^(f|m)\/.*/, "$1/…")).sort();
};

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

/** What the site's row says is live. */
const liveOf = (siteId: string) =>
  server.env.DB.prepare("SELECT live_publish_id AS live, previous_publish_id AS previous, seq FROM site WHERE id = ?")
    .bind(siteId)
    .first<{ live: string | null; previous: string | null; seq: number }>();

/** Plans one file for a publish and uploads it, without committing. */
const prepare = async (user: User, siteId: string, publishId: string, content: string) => {
  const base = `/api/sites/${siteId}/publishes/${publishId}`;
  const planned = await post(user, `${base}/plan`, { v: 1, files: { "index.html": { h: sha256(content), s: content.length } } });
  expect(planned.status).toBe(200);
  const put = await server.fetch(`${base}/files/${sha256(content)}`, {
    method: "PUT",
    headers: { authorization: user.authorization },
    body: content,
  });
  expect(put.status).toBe(200);
};

const commit = (user: User, siteId: string, publishId: string) =>
  post(user, `/api/sites/${siteId}/publishes/${publishId}/commit`, {}).then(answer);

/** Status and JSON body, for snapshots. */
// `any`: tests read fields off the body.
const answer = async (res: Response): Promise<{ status: number; body: any }> => ({
  status: res.status,
  body: await res.json(),
});

/**
 * Deep copy for snapshots: each value in `names` becomes its label, the test
 * server's address becomes http://server, and any other UUID becomes <id1>,
 * <id2>… in order of appearance.
 */
const readable = <T>(value: T, names: Record<string, string> = {}): T => {
  let text = JSON.stringify(value).replaceAll(server.url.origin, "http://server");
  for (const [raw, label] of Object.entries(names)) text = text.replaceAll(raw, label);
  const ids = new Map<string, string>();
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id)!;
  });
  return JSON.parse(text);
};

describe("POST /api/sites", () => {
  it("names the site after its title, and suffixes the name when it's taken", async () => {
    const user = await server.signIn();
    const first = await answer(await post(user, "/api/sites", { title: "Paper Shaders" }));
    const second = await answer(await post(user, "/api/sites", { title: "Paper Shaders" }));
    const suffix = second.body.slug.slice(-6);

    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
    expect(readable({ first, second }, { [suffix]: "<random>" })).toMatchInlineSnapshot(`
      {
        "first": {
          "body": {
            "id": "<id1>",
            "slug": "paper-shaders",
            "url": "https://share.test/s/paper-shaders",
          },
          "status": 201,
        },
        "second": {
          "body": {
            "id": "<id2>",
            "slug": "paper-shaders-<random>",
            "url": "https://share.test/s/paper-shaders-<random>",
          },
          "status": 201,
        },
      }
    `);
  });

  it("gives a random name to a reserved or unspellable title", async () => {
    const user = await server.signIn();
    const slugs = await Promise.all(
      ["Admin", "日本語 😀"].map(async (title) => (await createSite(user, title)).slug),
    );
    expect(slugs.map((slug) => slug.replace(/[a-z0-9]{6}$/, "<random>"))).toMatchInlineSnapshot(`
      [
        "admin-<random>",
        "<random>",
      ]
    `);
  });

  it("shortens a long title's slug, leaving room for a suffix", async () => {
    const user = await server.signIn();
    const title = `${"long ".repeat(20)}title`;
    const first = (await createSite(user, title)).slug;
    const second = (await createSite(user, title)).slug;
    expect({ first, second: second.replace(/[a-z0-9]{6}$/, "<random>"), lengths: [first.length, second.length] })
      .toMatchInlineSnapshot(`
        {
          "first": "long-long-long-long-long-long-long-long-long-long-long",
          "lengths": [
            54,
            61,
          ],
          "second": "long-long-long-long-long-long-long-long-long-long-long-<random>",
        }
      `);
  });

  it("takes only a bearer token, never a cookie", async () => {
    const user = await server.signIn();
    const cookie = `better-auth.session_token=${user.authorization.slice("Bearer ".length)}`;
    // The cookie is a working session: routes that take cookies accept it.
    expect((await server.fetch("/api/me", { headers: { cookie } })).status).toBe(200);

    const res = await server.fetch("/api/sites", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(await answer(res)).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "UNAUTHORIZED",
            "message": "Sign in required",
          },
        },
        "status": 401,
      }
    `);
  });

  it("refuses a missing title", async () => {
    const res = await post(await server.signIn(), "/api/sites", { title: "  " });
    expect(await answer(res)).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "INVALID_REQUEST",
            "message": "Body must be { title: string }",
          },
        },
        "status": 400,
      }
    `);
  });
});

describe("publishing", () => {
  it("uploads a folder with the app's client and goes live", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const started = await answer(await post(user, `/api/sites/${site.id}/publishes`));
    const { publishId, uploadUrl } = started.body;
    const names = { [site.id]: "<site>", [publishId]: "<publish>" };
    expect(readable(started, names)).toMatchInlineSnapshot(`
      {
        "body": {
          "publishId": "<publish>",
          "uploadUrl": "http://server/api/sites/<site>/publishes/<publish>",
        },
        "status": 201,
      }
    `);

    const dir = await siteDir({ "index.html": "<h1>hi</h1>", "assets/app.js": "console.log(1)" });
    const { commit: committed, uploadedFiles } = await upload(user, uploadUrl, dir);
    const live = await liveOf(site.id);
    // The client lost the answer and retries: same result.
    const retried = await commit(user, site.id, publishId);
    expect(readable({ commit: committed, uploadedFiles, live, retried }, names)).toMatchInlineSnapshot(`
      {
        "commit": {
          "alreadyCommitted": false,
          "previous": null,
          "publishId": "<publish>",
        },
        "live": {
          "live": "<publish>",
          "previous": null,
          "seq": 1,
        },
        "retried": {
          "body": {
            "alreadyCommitted": true,
            "previous": null,
            "publishId": "<publish>",
          },
          "status": 200,
        },
        "uploadedFiles": 2,
      }
    `);
  });

  it("uploads only what changed on the next publish", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const first = await startPublish(user, site.id);
    await upload(user, first.uploadUrl, await siteDir({ "index.html": "v1", "big.js": "same" }));

    const second = await startPublish(user, site.id);
    const result = await upload(user, second.uploadUrl, await siteDir({ "index.html": "v2", "big.js": "same" }));
    const names = { [first.publishId]: "<first>", [second.publishId]: "<second>" };
    expect(readable({ uploadedFiles: result.uploadedFiles, commit: result.commit }, names)).toMatchInlineSnapshot(`
      {
        "commit": {
          "alreadyCommitted": false,
          "previous": "<first>",
          "publishId": "<second>",
        },
        "uploadedFiles": 1,
      }
    `);
  });

  it("lets publishes overlap: the first to commit goes live, and the other is refused", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const slow = await startPublish(user, site.id);
    const fast = await startPublish(user, site.id);
    await prepare(user, site.id, slow.publishId, "slow");
    const { commit: committed } = await upload(user, fast.uploadUrl, await siteDir({ "index.html": "fast" }));
    const late = await commit(user, site.id, slow.publishId);
    const names = { [slow.publishId]: "<slow>", [fast.publishId]: "<fast>" };
    expect(readable({ committed, late, live: await liveOf(site.id) }, names)).toMatchInlineSnapshot(`
      {
        "committed": {
          "alreadyCommitted": false,
          "previous": null,
          "publishId": "<fast>",
        },
        "late": {
          "body": {
            "error": {
              "code": "SUPERSEDED",
              "details": {
                "live": "<fast>",
              },
              "message": "Publish <fast> went live after <slow> started",
            },
          },
          "status": 409,
        },
        "live": {
          "live": "<fast>",
          "previous": null,
          "seq": 1,
        },
      }
    `);
  });

  it("lets exactly one of two commits at the same moment go live", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const a = await startPublish(user, site.id);
    const b = await startPublish(user, site.id);
    await prepare(user, site.id, a.publishId, "a");
    await prepare(user, site.id, b.publishId, "b");
    const [ca, cb] = await Promise.all([commit(user, site.id, a.publishId), commit(user, site.id, b.publishId)]);
    const winner = ca.status === 200 ? a.publishId : b.publishId;
    const names = { [winner]: "<winner>", [winner === a.publishId ? b.publishId : a.publishId]: "<loser>" };
    expect(
      readable({ statuses: [ca.status, cb.status].sort(), live: await liveOf(site.id) }, names),
    ).toMatchInlineSnapshot(`
      {
        "live": {
          "live": "<winner>",
          "previous": null,
          "seq": 1,
        },
        "statuses": [
          200,
          409,
        ],
      }
    `);
  });

  it("never lets a late retry roll the site back, and records the version before", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const first = await startPublish(user, site.id);
    await upload(user, first.uploadUrl, await siteDir({ "index.html": "v1" }));
    const second = await startPublish(user, site.id);
    await upload(user, second.uploadUrl, await siteDir({ "index.html": "v2" }));
    // first's commit went through but its answer was lost; the client retries now.
    const retried = await commit(user, site.id, first.publishId);
    const names = { [first.publishId]: "<first>", [second.publishId]: "<second>" };
    expect(readable({ retried, live: await liveOf(site.id) }, names)).toMatchInlineSnapshot(`
      {
        "live": {
          "live": "<second>",
          "previous": "<first>",
          "seq": 2,
        },
        "retried": {
          "body": {
            "error": {
              "code": "SUPERSEDED",
              "details": {
                "live": "<second>",
              },
              "message": "Publish <second> went live after <first> started",
            },
          },
          "status": 409,
        },
      }
    `);
  });

  it("refuses to commit, on another site, a publish started on this one", async () => {
    const user = await server.signIn();
    const started = await createSite(user, "started here");
    const other = await createSite(user, "committed there");
    const { publishId } = await startPublish(user, started.id);
    await prepare(user, other.id, publishId, "x");
    const names = { [publishId]: "<publish>", [other.id]: "<other>" };
    expect(
      readable({ commit: await commit(user, other.id, publishId), other: await liveOf(other.id) }, names),
    ).toMatchInlineSnapshot(`
      {
        "commit": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "No publish <publish> was started for this site",
            },
          },
          "status": 404,
        },
        "other": {
          "live": null,
          "previous": null,
          "seq": 0,
        },
      }
    `);
  });

  it("refuses to commit a publish that was planned but never started", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    await prepare(user, site.id, "made-up", "x");
    expect({ commit: await commit(user, site.id, "made-up"), live: await liveOf(site.id) }).toMatchInlineSnapshot(`
      {
        "commit": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "No publish made-up was started for this site",
            },
          },
          "status": 404,
        },
        "live": {
          "live": null,
          "previous": null,
          "seq": 0,
        },
      }
    `);
  });

  it("deletes nothing, even files no version needs any more", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    // A plan made two hours ago and never committed: past cleanup's one-hour
    // grace, so a cleanup not keeping it would delete it at once.
    const stale = `sites/${site.id}/m/stale.json`;
    await server.env.SITES.put(stale, "{}", { customMetadata: { createdAt: String(Date.now() - 2 * 60 * 60 * 1000) } });
    // Then two publishes, the second replacing the first's only file.
    for (const version of ["v1", "v2"]) {
      const { uploadUrl } = await startPublish(user, site.id);
      await upload(user, uploadUrl, await siteDir({ "index.html": version }));
    }
    expect({ stalePlanKept: (await server.env.SITES.head(stale)) !== null, stored: await stored(site.id) })
      .toMatchInlineSnapshot(`
        {
          "stalePlanKept": true,
          "stored": [
            "f/…",
            "f/…",
            "m/…",
            "m/…",
            "m/…",
          ],
        }
      `);
  });

  it("hides one user's sites from another", async () => {
    const owner = await server.signIn();
    const other = await server.signIn();
    const site = await createSite(owner);
    const { publishId } = await startPublish(owner, site.id);

    const start = await post(other, `/api/sites/${site.id}/publishes`);
    const plan = await post(other, `/api/sites/${site.id}/publishes/${publishId}/plan`, { v: 1, files: {} });
    expect({ start: await answer(start), plan: await answer(plan), stored: await stored(site.id) }).toMatchInlineSnapshot(`
      {
        "plan": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "No such site",
            },
          },
          "status": 404,
        },
        "start": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "No such site",
            },
          },
          "status": 404,
        },
        "stored": [],
      }
    `);
  });

  it("answers unknown sites, publishes and routes in the error envelope", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId } = await startPublish(user, site.id);
    const base = `/api/sites/${site.id}/publishes`;
    const answers = {
      unknownSite: await answer(await post(user, `/api/sites/nope/publishes`)),
      unknownPublish: await answer(await post(user, `${base}/nope/commit`, {})),
      unknownRoute: await answer(await post(user, `${base}/${publishId}/nope`, {})),
    };
    expect(answers).toMatchInlineSnapshot(`
      {
        "unknownPublish": {
          "body": {
            "error": {
              "code": "NO_PLAN",
              "message": "No plan was recorded for publish nope",
            },
          },
          "status": 404,
        },
        "unknownRoute": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "Unknown upload route",
            },
          },
          "status": 404,
        },
        "unknownSite": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "No such site",
            },
          },
          "status": 404,
        },
      }
    `);
  });
});

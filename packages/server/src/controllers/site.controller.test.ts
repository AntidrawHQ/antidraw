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

const lockOf = (siteId: string) =>
  server.env.DB.prepare("SELECT lock_publish_id AS publishId, lock_until AS until FROM site WHERE id = ?")
    .bind(siteId)
    .first<{ publishId: string | null; until: number | null }>();

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
  it("uploads a folder with the app's client, goes live, and releases the lock", async () => {
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
    const lock = await lockOf(site.id);
    const lockMinutes = Math.round((lock!.until! - Date.now()) / 60_000);
    expect(readable({ holder: lock?.publishId, lockMinutes }, names)).toMatchInlineSnapshot(`
      {
        "holder": "<publish>",
        "lockMinutes": 60,
      }
    `);

    const dir = await siteDir({ "index.html": "<h1>hi</h1>", "assets/app.js": "console.log(1)" });
    const { commit, uploadedFiles } = await upload(user, uploadUrl, dir);
    const pointer = await server.env.SITES.get(`sites/${site.id}/current.json`);
    const record = await server.env.DB.prepare("SELECT status, previous FROM publish WHERE id = ?")
      .bind(publishId)
      .first();
    const after = {
      commit,
      uploadedFiles,
      lock: await lockOf(site.id),
      record,
      live: ((await pointer?.json()) as { publishId: string }).publishId,
    };
    expect(readable(after, names)).toMatchInlineSnapshot(`
      {
        "commit": {
          "alreadyCommitted": false,
          "previous": null,
          "publishId": "<publish>",
        },
        "live": "<publish>",
        "lock": {
          "publishId": null,
          "until": null,
        },
        "record": {
          "previous": null,
          "status": "live",
        },
        "uploadedFiles": 2,
      }
    `);

    // The client lost the answer and retries after the lock is gone: same
    // result. Anything else for this publish is too late.
    const retried = await post(user, `/api/sites/${site.id}/publishes/${publishId}/commit`, {});
    const late = await post(user, `/api/sites/${site.id}/publishes/${publishId}/plan`, { v: 1, files: {} });
    expect(readable({ retried: await answer(retried), late: await answer(late) }, names)).toMatchInlineSnapshot(`
      {
        "late": {
          "body": {
            "error": {
              "code": "CONFLICT",
              "message": "This publish is already live",
            },
          },
          "status": 409,
        },
        "retried": {
          "body": {
            "alreadyCommitted": true,
            "previous": null,
            "publishId": "<publish>",
          },
          "status": 200,
        },
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

  it("lets a new publish replace a running one, whose requests are then refused", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const stale = await startPublish(user, site.id);
    const fresh = await startPublish(user, site.id);

    const refused = await upload(user, stale.uploadUrl, await siteDir({ "index.html": "old" })).catch((e) => e);
    const result = await upload(user, fresh.uploadUrl, await siteDir({ "index.html": "new" }));
    const names = { [stale.publishId]: "<stale>", [fresh.publishId]: "<fresh>" };
    expect(readable({ refused: `${refused.code}: ${refused.message}`, commit: result.commit }, names))
      .toMatchInlineSnapshot(`
        {
          "commit": {
            "alreadyCommitted": false,
            "previous": null,
            "publishId": "<fresh>",
          },
          "refused": "SUPERSEDED: A newer publish of this site replaced this one",
        }
      `);
  });

  it("refuses a publish whose time ran out", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { uploadUrl } = await startPublish(user, site.id);
    await server.env.DB.prepare("UPDATE site SET lock_until = ? WHERE id = ?").bind(Date.now() - 1, site.id).run();

    const refused = await upload(user, uploadUrl, await siteDir({ "index.html": "x" })).catch((e) => e);
    expect(`${refused.code}: ${refused.message}`).toMatchInlineSnapshot(`"PLAN_EXPIRED: This publish ran out of time; start a new one"`);
  });

  it("hides one user's sites from another", async () => {
    const owner = await server.signIn();
    const other = await server.signIn();
    const site = await createSite(owner);
    const { publishId } = await startPublish(owner, site.id);

    const start = await post(other, `/api/sites/${site.id}/publishes`);
    const plan = await post(other, `/api/sites/${site.id}/publishes/${publishId}/plan`, { v: 1, files: {} });
    expect({ start: await answer(start), plan: await answer(plan) }).toMatchInlineSnapshot(`
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
      }
    `);
    // Nor did the attempt take the owner's lock.
    expect((await lockOf(site.id))?.publishId).toBe(publishId);
  });

  it("answers unknown publishes and routes in the error envelope", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId } = await startPublish(user, site.id);
    const base = `/api/sites/${site.id}/publishes`;
    const answers = {
      unknownPublish: await answer(await post(user, `${base}/nope/commit`, {})),
      unknownRoute: await answer(await post(user, `${base}/${publishId}/nope`, {})),
    };
    expect(answers).toMatchInlineSnapshot(`
      {
        "unknownPublish": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "No such publish",
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
      }
    `);
  });
});

describe("the cron trigger", () => {
  it("releases sites whose publish was abandoned past the grace period, and only those", async () => {
    const user = await server.signIn();
    const abandoned = await createSite(user);
    const recent = await createSite(user);
    const gone = await startPublish(user, abandoned.id);
    const running = await startPublish(user, recent.id);
    const hour = 60 * 60 * 1000;
    const setLockUntil = (id: string, until: number) =>
      server.env.DB.prepare("UPDATE site SET lock_until = ? WHERE id = ?").bind(until, id).run();
    await setLockUntil(abandoned.id, Date.now() - hour - 60_000);
    await setLockUntil(recent.id, Date.now() - hour + 60_000);

    await server.scheduled();

    const locks = {
      abandoned: (await lockOf(abandoned.id))?.publishId,
      recent: (await lockOf(recent.id))?.publishId,
    };
    const names = { [gone.publishId]: "<abandoned publish>", [running.publishId]: "<running publish>" };
    expect(readable(locks, names)).toMatchInlineSnapshot(`
      {
        "abandoned": null,
        "recent": "<running publish>",
      }
    `);
  });
});

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

const siteRow = (siteId: string) =>
  server.env.DB.prepare(
    "SELECT lock_publish_id AS holder, busy_until AS busyUntil, cleanup_after AS cleanupAfter FROM site WHERE id = ?",
  )
    .bind(siteId)
    .first<{ holder: string | null; busyUntil: number | null; cleanupAfter: number | null }>();

const setSite = (siteId: string, columns: Record<string, string | number | null>) =>
  server.env.DB.prepare(
    `UPDATE site SET ${Object.keys(columns).map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
  )
    .bind(...Object.values(columns), siteId)
    .run();

const statusOf = async (publishId: string) =>
  (await server.env.DB.prepare("SELECT status FROM publish WHERE id = ?").bind(publishId).first<{ status: string }>())
    ?.status;

const HOUR = 60 * 60 * 1000;

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
    // The scheduled cleanup may clear what this publish leaves once its lock,
    // then the library's plan TTL and grace period, have run out.
    const cleanupMinutes = Math.round(((await siteRow(site.id))!.cleanupAfter! - Date.now()) / 60_000);
    expect(readable({ holder: lock?.publishId, lockMinutes, cleanupMinutes }, names)).toMatchInlineSnapshot(`
      {
        "cleanupMinutes": 125,
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
      busyUntil: (await siteRow(site.id))?.busyUntil,
      record,
      live: ((await pointer?.json()) as { publishId: string }).publishId,
    };
    expect(readable(after, names)).toMatchInlineSnapshot(`
      {
        "busyUntil": null,
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
    // Still, once the newer one has gone live and released the lock.
    const late = await post(user, `/api/sites/${site.id}/publishes/${stale.publishId}/commit`, {});
    const names = { [stale.publishId]: "<stale>", [fresh.publishId]: "<fresh>" };
    expect(
      readable(
        { refused: `${refused.code}: ${refused.message}`, commit: result.commit, late: (await answer(late)).body },
        names,
      ),
    ).toMatchInlineSnapshot(`
      {
        "commit": {
          "alreadyCommitted": false,
          "previous": null,
          "publishId": "<fresh>",
        },
        "late": {
          "error": {
            "code": "SUPERSEDED",
            "message": "A newer publish of this site replaced this one",
          },
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

  it("still says a publish ran out of time after the cron has cleared its lock", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId, uploadUrl } = await startPublish(user, site.id);
    await setSite(site.id, { lock_until: Date.now() - 2 * HOUR, cleanup_after: Date.now() - 1 });
    await server.scheduled();
    expect((await siteRow(site.id))?.holder).toBeNull();

    const refused = await upload(user, uploadUrl, await siteDir({ "index.html": "x" })).catch((e) => e);
    expect({ refused: `${refused.code}: ${refused.message}`, status: await statusOf(publishId) }).toMatchInlineSnapshot(`
      {
        "refused": "PLAN_EXPIRED: This publish ran out of time; start a new one",
        "status": "open",
      }
    `);
  });

  it("keeps a new publish out while a plan, commit or cleanup of the site runs", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    await startPublish(user, site.id);
    // What a plan or commit of the running publish sets while it runs.
    await setSite(site.id, { busy_until: Date.now() + 60_000 });
    const whileCommitting = await post(user, `/api/sites/${site.id}/publishes`);
    // What the scheduled cleanup's claim sets.
    await setSite(site.id, { lock_publish_id: "cleanup-x", busy_until: Date.now() + 60_000 });
    const whileCleaning = await post(user, `/api/sites/${site.id}/publishes`);
    const refusals = await Promise.all(
      [whileCommitting, whileCleaning].map(async (res) => ({ ...(await answer(res)), retryAfter: res.headers.get("retry-after") })),
    );

    // A hold whose request died lapses.
    await setSite(site.id, { busy_until: Date.now() - 1 });
    const later = await post(user, `/api/sites/${site.id}/publishes`);
    expect({ refusals, later: later.status }).toMatchInlineSnapshot(`
      {
        "later": 201,
        "refusals": [
          {
            "body": {
              "error": {
                "code": "SITE_BUSY",
                "message": "This site is finishing a publish or a cleanup; try again in a moment",
              },
            },
            "retryAfter": "2",
            "status": 409,
          },
          {
            "body": {
              "error": {
                "code": "SITE_BUSY",
                "message": "This site is finishing a publish or a cleanup; try again in a moment",
              },
            },
            "retryAfter": "2",
            "status": 409,
          },
        ],
      }
    `);
  });

  it("holds the site for as long as a plan runs", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId } = await startPublish(user, site.id);
    // A plan whose body arrives in two parts: it's running, reading, between them.
    const manifest = JSON.stringify({ v: 1, files: { "index.html": { h: "b".repeat(64), s: 1 } } });
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(manifest.slice(0, 10)));
        finish = () => {
          controller.enqueue(new TextEncoder().encode(manifest.slice(10)));
          controller.close();
        };
      },
    });
    const plan = server.fetch(`/api/sites/${site.id}/publishes/${publishId}/plan`, {
      method: "POST",
      headers: { authorization: user.authorization, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    // Until the request has reached the Worker.
    for (let tries = 0; tries < 50 && !(await siteRow(site.id))?.busyUntil; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const during = await post(user, `/api/sites/${site.id}/publishes`);
    finish();
    const planned = await plan;
    const after = await post(user, `/api/sites/${site.id}/publishes`);
    expect({ during: during.status, planned: planned.status, after: after.status }).toMatchInlineSnapshot(`
      {
        "after": 201,
        "during": 409,
        "planned": 200,
      }
    `);
  });

  it("clears its hold on the site after a failed commit", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId } = await startPublish(user, site.id);
    const res = await post(user, `/api/sites/${site.id}/publishes/${publishId}/commit`, {});
    expect({ status: res.status, busyUntil: (await siteRow(site.id))?.busyUntil }).toMatchInlineSnapshot(`
      {
        "busyUntil": null,
        "status": 404,
      }
    `);
  });

  it("records a commit that went live without being recorded when it's retried", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId, uploadUrl } = await startPublish(user, site.id);
    await upload(user, uploadUrl, await siteDir({ "index.html": "x" }));
    // As if the Worker stopped between the commit and finishPublish, and the
    // client retries only after the lock ran out.
    await server.env.DB.prepare("UPDATE publish SET status = 'open', committed_at = NULL WHERE id = ?").bind(publishId).run();
    await setSite(site.id, { lock_publish_id: publishId, lock_until: Date.now() - 1 });

    const retried = await post(user, `/api/sites/${site.id}/publishes/${publishId}/commit`, {});
    expect(
      readable(
        { retried: await answer(retried), status: await statusOf(publishId), holder: (await siteRow(site.id))?.holder },
        { [publishId]: "<publish>" },
      ),
    ).toMatchInlineSnapshot(`
      {
        "holder": null,
        "retried": {
          "body": {
            "alreadyCommitted": true,
            "previous": null,
            "publishId": "<publish>",
          },
          "status": 200,
        },
        "status": "live",
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
  it("cleans up sites past their cleanup time, including ones a later publish committed, and only those", async () => {
    const user = await server.signIn();
    const [committed, abandoned, running, claimed] = await Promise.all(
      ["committed", "abandoned", "running", "claimed"].map((title) => createSite(user, title)),
    );
    // A publish that uploaded and was replaced by one that committed.
    const replaced = await startPublish(user, committed.id);
    const planned = await post(user, `/api/sites/${committed.id}/publishes/${replaced.publishId}/plan`, {
      v: 1,
      files: { "index.html": { h: "a".repeat(64), s: 1 } },
    });
    expect(planned.status).toBe(200);
    const winner = await startPublish(user, committed.id);
    await upload(user, winner.uploadUrl, await siteDir({ "index.html": "x" }));
    const gone = await startPublish(user, abandoned.id);
    const live = await startPublish(user, running.id);
    await startPublish(user, claimed.id);
    const past = { cleanup_after: Date.now() - 1 };
    await setSite(committed.id, past);
    await setSite(abandoned.id, { ...past, lock_until: Date.now() - 2 * HOUR });
    // Another run's claim, still held.
    await setSite(claimed.id, { ...past, lock_publish_id: "cleanup-other", busy_until: Date.now() + 60_000 });

    await server.scheduled();

    const rows = Object.fromEntries(
      await Promise.all(
        Object.entries({ committed, abandoned, running, claimed }).map(async ([name, site]) => {
          const row = (await siteRow(site.id))!;
          return [name, { holder: row.holder, cleaned: row.cleanupAfter === null }];
        }),
      ),
    );
    const names = { [gone.publishId]: "<abandoned publish>", [live.publishId]: "<running publish>" };
    expect(readable(rows, names)).toMatchInlineSnapshot(`
      {
        "abandoned": {
          "cleaned": true,
          "holder": null,
        },
        "claimed": {
          "cleaned": false,
          "holder": "cleanup-other",
        },
        "committed": {
          "cleaned": true,
          "holder": null,
        },
        "running": {
          "cleaned": false,
          "holder": "<running publish>",
        },
      }
    `);
  });

  it("lets publishes start again right after a cleanup fails, and tries it again next run", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    await startPublish(user, site.id);
    await setSite(site.id, { lock_until: Date.now() - 2 * HOUR, cleanup_after: Date.now() - 1 });
    // A pointer the store can't read makes the cleanup fail.
    const pointer = `sites/${site.id}/current.json`;
    await server.env.SITES.put(pointer, "not a pointer");
    try {
      await server.scheduled();
      const row = (await siteRow(site.id))!;
      const start = await post(user, `/api/sites/${site.id}/publishes`);
      expect({
        holder: row.holder,
        busyUntil: row.busyUntil,
        stillDue: row.cleanupAfter !== null && row.cleanupAfter <= Date.now(),
        start: start.status,
      }).toMatchInlineSnapshot(`
        {
          "busyUntil": null,
          "holder": null,
          "start": 201,
          "stillDue": true,
        }
      `);
    } finally {
      await server.env.SITES.delete(pointer);
    }
  });

  it("records a commit that went live without being recorded", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId, uploadUrl } = await startPublish(user, site.id);
    await upload(user, uploadUrl, await siteDir({ "index.html": "x" }));
    await server.env.DB.prepare("UPDATE publish SET status = 'open', committed_at = NULL WHERE id = ?").bind(publishId).run();
    await setSite(site.id, { cleanup_after: Date.now() - 1 });

    await server.scheduled();
    expect(await statusOf(publishId)).toBe("live");
  });

  it("works through more sites than one query reads", async () => {
    const user = await server.signIn();
    const ids = Array.from({ length: 30 }, () => crypto.randomUUID());
    await server.env.DB.batch(
      ids.map((id, i) =>
        server.env.DB.prepare(
          "INSERT INTO site (id, owner_id, slug, title, cleanup_after) VALUES (?, ?, ?, 'x', ?)",
        ).bind(id, user.userId, `many-${id}`, Date.now() - 1000 + i),
      ),
    );

    await server.scheduled();

    const { left } = (await server.env.DB.prepare(
      `SELECT count(*) AS left FROM site WHERE cleanup_after IS NOT NULL AND id IN (${ids.map(() => "?").join(", ")})`,
    )
      .bind(...ids)
      .first<{ left: number }>())!;
    expect(left).toBe(0);
  });
});

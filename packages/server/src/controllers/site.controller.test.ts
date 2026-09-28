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

const errorOf = async (res: Response) => ({ status: res.status, ...((await res.json()) as object) });

describe("POST /api/sites", () => {
  it("names the site after its title, and suffixes the name when it's taken", async () => {
    const user = await server.signIn();
    const title = `Paper Shaders ${Date.now()}`;
    const first = await createSite(user, title);
    const second = await createSite(user, title);

    expect(first.slug).toBe(`paper-shaders-${title.split(" ")[2]}`);
    expect(first.url).toBe(`https://${first.slug}.sites.test`);
    expect(second.slug).toMatch(new RegExp(`^${first.slug}-[a-z0-9]{6}$`));
    expect(second.id).not.toBe(first.id);
  });

  it("gives a random name to a reserved or unspellable title", async () => {
    const user = await server.signIn();
    expect((await createSite(user, "Admin")).slug).toMatch(/^admin-[a-z0-9]{6}$/);
    expect((await createSite(user, "日本語 😀")).slug).toMatch(/^[a-z0-9]{6}$/);
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
    expect(await errorOf(res)).toEqual({
      status: 401,
      error: { code: "UNAUTHORIZED", message: "Sign in required" },
    });
  });

  it("refuses a missing title", async () => {
    const res = await post(await server.signIn(), "/api/sites", { title: "  " });
    expect(await errorOf(res)).toEqual({
      status: 400,
      error: { code: "INVALID_REQUEST", message: "Body must be { title: string }" },
    });
  });
});

describe("publishing", () => {
  it("uploads a folder with the app's client, goes live, and releases the lock", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { publishId, uploadUrl } = await startPublish(user, site.id);
    expect(uploadUrl).toBe(new URL(`/api/sites/${site.id}/publishes/${publishId}`, server.url).href);
    expect((await lockOf(site.id))?.publishId).toBe(publishId);

    const dir = await siteDir({ "index.html": "<h1>hi</h1>", "assets/app.js": "console.log(1)" });
    const result = await upload(user, uploadUrl, dir);

    expect(result.commit).toEqual({ publishId, previous: null, alreadyCommitted: false });
    expect(result.uploadedFiles).toBe(2);
    expect(await lockOf(site.id)).toEqual({ publishId: null, until: null });
    const record = await server.env.DB.prepare("SELECT status, previous FROM publish WHERE id = ?")
      .bind(publishId)
      .first();
    expect(record).toEqual({ status: "live", previous: null });
    const pointer = await server.env.SITES.get(`sites/${site.id}/current.json`);
    expect(((await pointer?.json()) as { publishId: string }).publishId).toBe(publishId);

    // The client lost the answer and retries after the lock is gone: same result.
    const retried = await post(user, `/api/sites/${site.id}/publishes/${publishId}/commit`, {});
    expect(await retried.json()).toEqual({ publishId, previous: null, alreadyCommitted: true });
    const late = await post(user, `/api/sites/${site.id}/publishes/${publishId}/plan`, { v: 1, files: {} });
    expect(await errorOf(late)).toMatchObject({ status: 409, error: { code: "CONFLICT" } });
  });

  it("uploads only what changed on the next publish", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const first = await startPublish(user, site.id);
    await upload(user, first.uploadUrl, await siteDir({ "index.html": "v1", "big.js": "same" }));

    const second = await startPublish(user, site.id);
    const result = await upload(user, second.uploadUrl, await siteDir({ "index.html": "v2", "big.js": "same" }));
    expect(result.uploadedFiles).toBe(1);
    expect(result.commit.previous).toBe(first.publishId);
  });

  it("lets a new publish replace a running one, whose requests are then refused", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const stale = await startPublish(user, site.id);
    const fresh = await startPublish(user, site.id);

    await expect(upload(user, stale.uploadUrl, await siteDir({ "index.html": "old" }))).rejects.toMatchObject({
      code: "SUPERSEDED",
    });
    const result = await upload(user, fresh.uploadUrl, await siteDir({ "index.html": "new" }));
    expect(result.commit.publishId).toBe(fresh.publishId);
  });

  it("refuses a publish whose time ran out", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const { uploadUrl } = await startPublish(user, site.id);
    await server.env.DB.prepare("UPDATE site SET lock_until = ? WHERE id = ?").bind(Date.now() - 1, site.id).run();

    await expect(upload(user, uploadUrl, await siteDir({ "index.html": "x" }))).rejects.toMatchObject({
      code: "PLAN_EXPIRED",
    });
  });

  it("hides one user's sites from another", async () => {
    const owner = await server.signIn();
    const other = await server.signIn();
    const site = await createSite(owner);
    const { publishId } = await startPublish(owner, site.id);
    const notFound = { status: 404, error: { code: "NOT_FOUND", message: "No such site" } };

    expect(await errorOf(await post(other, `/api/sites/${site.id}/publishes`))).toEqual(notFound);
    const plan = await post(other, `/api/sites/${site.id}/publishes/${publishId}/plan`, { v: 1, files: {} });
    expect(await errorOf(plan)).toEqual(notFound);
    // Nor did the attempt take the owner's lock.
    expect((await lockOf(site.id))?.publishId).toBe(publishId);
  });

  it("answers unknown publishes and routes in the error envelope", async () => {
    const user = await server.signIn();
    const site = await createSite(user);
    const unknown = await post(user, `/api/sites/${site.id}/publishes/nope/commit`, {});
    expect(await errorOf(unknown)).toEqual({
      status: 404,
      error: { code: "NOT_FOUND", message: "No such publish" },
    });
    const { publishId } = await startPublish(user, site.id);
    const route = await post(user, `/api/sites/${site.id}/publishes/${publishId}/nope`, {});
    expect(await errorOf(route)).toMatchObject({ status: 404, error: { code: "NOT_FOUND" } });
  });
});

describe("the cron trigger", () => {
  it("releases sites whose publish was abandoned past the grace period, and only those", async () => {
    const user = await server.signIn();
    const abandoned = await createSite(user);
    const recent = await createSite(user);
    await startPublish(user, abandoned.id);
    const running = await startPublish(user, recent.id);
    const hour = 60 * 60 * 1000;
    const setLockUntil = (id: string, until: number) =>
      server.env.DB.prepare("UPDATE site SET lock_until = ? WHERE id = ?").bind(until, id).run();
    await setLockUntil(abandoned.id, Date.now() - hour - 60_000);
    await setLockUntil(recent.id, Date.now() - hour + 60_000);

    await server.scheduled();

    expect(await lockOf(abandoned.id)).toEqual({ publishId: null, until: null });
    expect((await lockOf(recent.id))?.publishId).toBe(running.publishId);
  });
});

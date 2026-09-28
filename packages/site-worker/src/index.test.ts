import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SiteStore, type Bucket, type Files } from "@antidraw/site-upload/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import type { Env } from "./index";

// This Worker in workerd with local D1 (the server's migrations) and R2, via
// Wrangler's test harness. Sites are published the way the server does it:
// a site row in D1, then SiteStore's plan, upload and commit under its id.

let harness: ReturnType<typeof createTestHarness>;
let env: Env;
let store: SiteStore;
beforeAll(async () => {
  harness = createTestHarness({
    root: fileURLToPath(new URL("..", import.meta.url)),
    workers: [{ configPath: "./wrangler.jsonc", vars: { SITE_DOMAIN: "sites.test", SHARE_URL_PATTERN: "https://share.test/s/*" } }],
  });
  await harness.listen();
  const worker = harness.getWorker<Env>();
  await worker.applyD1Migrations("DB");
  env = await worker.getEnv();
  store = new SiteStore({ bucket: env.SITES as unknown as Bucket });
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'u', 'u@example.com', 1, 0, 0)",
  ).run();
}, 60_000);
afterAll(() => harness?.close());

let sites = 0;
async function publish(slug: string, contents: Record<string, string>) {
  const siteId = `site-${++sites}`;
  await env.DB.prepare("INSERT INTO site (id, owner_id, slug, title) VALUES (?, 'u1', ?, ?)")
    .bind(siteId, slug, slug)
    .run();
  const files: Files = Object.create(null);
  const bodies = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(contents)) {
    const body = new TextEncoder().encode(content);
    const h = createHash("sha256").update(body).digest("hex");
    files[path] = { h, s: body.length };
    bodies.set(h, body);
  }
  const { missing } = await store.plan(siteId, "p1", { v: 1, files });
  for (const hash of missing) await store.putFile(siteId, "p1", hash, bodies.get(hash)!, bodies.get(hash)!.length);
  await store.commit(siteId, "p1");
  return siteId;
}

/** Status, the headers worth reviewing, and the body. */
async function get(url: string) {
  const res = await harness.getWorker().fetch(url, { redirect: "manual" });
  const headers = Object.fromEntries(
    ["content-type", "cache-control", "location", "access-control-allow-origin"].flatMap((name) => {
      const value = res.headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
  return { status: res.status, headers, body: await res.text() };
}

describe("site worker", () => {
  it("serves a published site at its slug's subdomain", async () => {
    await publish("my-canvas", { "preview.html": "<h1>hi</h1>", "assets/app.js": "console.log(1)" });

    expect(await get("https://my-canvas.sites.test/preview?componentName=Card")).toMatchInlineSnapshot(`
      {
        "body": "<h1>hi</h1>",
        "headers": {
          "cache-control": "public, max-age=0, must-revalidate",
          "content-type": "text/html; charset=utf-8",
        },
        "status": 200,
      }
    `);
    expect(await get("https://my-canvas.sites.test/assets/app.js")).toMatchInlineSnapshot(`
      {
        "body": "console.log(1)",
        "headers": {
          "cache-control": "public, max-age=0, must-revalidate",
          "content-type": "text/javascript; charset=utf-8",
        },
        "status": 200,
      }
    `);
  });

  it("sends / to the site's share page", async () => {
    await publish("shared", { "preview.html": "preview", "index.html": "never served" });

    expect(await get("https://shared.sites.test/")).toMatchInlineSnapshot(`
      {
        "body": "",
        "headers": {
          "cache-control": "no-store",
          "location": "https://share.test/s/shared",
        },
        "status": 302,
      }
    `);
  });

  it("lets any origin read canvas.json, and nothing else", async () => {
    await publish("cors", { "preview.html": "preview", "canvas.json": '{"layouts":[]}' });

    expect({
      canvas: await get("https://cors.sites.test/canvas.json"),
      preview: (await get("https://cors.sites.test/preview")).headers,
    }).toMatchInlineSnapshot(`
      {
        "canvas": {
          "body": "{"layouts":[]}",
          "headers": {
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=0, must-revalidate",
            "content-type": "application/json",
          },
          "status": 200,
        },
        "preview": {
          "cache-control": "public, max-age=0, must-revalidate",
          "content-type": "text/html; charset=utf-8",
        },
      }
    `);
  });

  it("keeps each site to its own subdomain", async () => {
    await publish("first", { "preview.html": "first" });
    await publish("second", { "preview.html": "second" });

    expect((await get("https://first.sites.test/preview")).body).toBe("first");
    expect((await get("https://second.sites.test/preview")).body).toBe("second");
  });

  it("answers 404 for hosts that name no site", async () => {
    const hosts = [
      "https://nobody.sites.test/", // no such slug
      "https://sites.test/", // the bare domain
      "https://a.b.sites.test/", // nested subdomain
      "https://my-canvas.elsewhere.test/", // another domain
    ];
    const answers = await Promise.all(
      hosts.map(async (url) => {
        const { status, headers, body } = await get(url);
        return `${status} ${headers["cache-control"]} ${body}`;
      }),
    );
    expect(answers).toMatchInlineSnapshot(`
      [
        "404 no-store Site not found",
        "404 no-store Site not found",
        "404 no-store Site not found",
        "404 no-store Site not found",
      ]
    `);
  });
});

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SiteStore, type Bucket, type Files } from "@antidraw/site-upload/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import type { Env } from "./index";

// This Worker in workerd with local D1 (the server's migrations) and R2, via
// Wrangler's test harness. Sites are published the way the server does it:
// a site row in D1, SiteStore's plan and upload under its id, then the row
// records the publish as live. FLAGS is the server's stub Worker
// (packages/server/src/test/flags-stub), which serves each flag's fallback
// until a test sets it.

/** The Flagship stand-in, driven from Node. */
type FlagsStub = {
  set(key: string, value: boolean): Promise<void>;
  clear(key: string): Promise<void>;
  setFailing(value: boolean): Promise<void>;
};

let harness: ReturnType<typeof createTestHarness>;
let env: Env;
let store: SiteStore;
let flags: FlagsStub;
beforeAll(async () => {
  harness = createTestHarness({
    root: fileURLToPath(new URL("..", import.meta.url)),
    workers: [
      {
        configPath: "./wrangler.jsonc",
        vars: { SITE_DOMAIN: "sites.test", SHARE_URL_PATTERN: "https://share.test/s/*" },
        bindingOverrides: { FLAGS: "flags-stub" },
      },
      { configPath: "../server/src/test/flags-stub/wrangler.jsonc" },
    ],
  });
  await harness.listen();
  const worker = harness.getWorker<Env>();
  await worker.applyD1Migrations("DB");
  env = await worker.getEnv();
  flags = (await harness.getWorker("flags-stub").getExport()) as unknown as FlagsStub;
  store = new SiteStore({ bucket: env.SITES as unknown as Bucket });
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'u', 'u@example.com', 1, 0, 0)",
  ).run();
}, 60_000);
afterAll(() => harness?.close());

let sites = 0;
async function publish(slug: string, contents: Record<string, string>, immutable: string[] = []) {
  const siteId = `site-${++sites}`;
  await env.DB.prepare("INSERT INTO site (id, owner_id, slug, title) VALUES (?, 'u1', ?, ?)")
    .bind(siteId, slug, slug)
    .run();
  await republish(siteId, "p1", contents, immutable);
  return siteId;
}

/** Uploads another version and records it live, as the server's commit does. */
async function republish(siteId: string, publishId: string, contents: Record<string, string>, immutable: string[] = []) {
  const files: Files = Object.create(null);
  const bodies = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(contents)) {
    const body = new TextEncoder().encode(content);
    const h = createHash("sha256").update(body).digest("hex");
    files[path] = { h, s: body.length, ...(immutable.includes(path) && { i: true as const }) };
    bodies.set(h, body);
  }
  const { missing } = await store.plan(siteId, publishId, { v: 1, files });
  for (const hash of missing) await store.putFile(siteId, publishId, hash, bodies.get(hash)!, bodies.get(hash)!.length);
  await store.requireComplete(siteId, publishId);
  await env.DB.prepare(
    "UPDATE site SET previous_publish_id = live_publish_id, live_publish_id = ?, seq = seq + 1 WHERE id = ?",
  )
    .bind(publishId, siteId)
    .run();
}

/** Status, the headers worth reviewing, and the body. */
async function get(url: string) {
  const res = await harness.getWorker().fetch(url, { redirect: "manual" });
  const names = ["content-type", "cache-control", "location", "access-control-allow-origin", "retry-after", "x-robots-tag"];
  const headers = Object.fromEntries(
    names.flatMap((name) => {
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
          "x-robots-tag": "noindex",
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
          "x-robots-tag": "noindex",
        },
        "status": 200,
      }
    `);
  });

  it("serves the version D1 records as live, and the previous one's hashed chunks", async () => {
    const siteId = await publish("versions", { "preview.html": "v1", "assets/app-1.js": "js1" }, ["assets/app-1.js"]);
    await republish(siteId, "p2", { "preview.html": "v2", "assets/app-2.js": "js2" }, ["assets/app-2.js"]);
    const status = async (path: string) => {
      const res = await get(`https://versions.sites.test${path}`);
      return `${res.status} ${res.body}`;
    };
    expect({
      page: await status("/preview"),
      "live chunk": await status("/assets/app-2.js"),
      "previous version's chunk": await status("/assets/app-1.js"),
    }).toMatchInlineSnapshot(`
      {
        "live chunk": "200 js2",
        "page": "200 v2",
        "previous version's chunk": "200 js1",
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
          "x-robots-tag": "noindex",
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
            "x-robots-tag": "noindex",
          },
          "status": 200,
        },
        "preview": {
          "cache-control": "public, max-age=0, must-revalidate",
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex",
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
      "https://nobody.sites.test/canvas.json", // readable by the share page
    ];
    const answers = await Promise.all(
      hosts.map(async (url) => {
        const { status, headers, body } = await get(url);
        return `${status} ${headers["cache-control"]} ${body} ${headers["access-control-allow-origin"] ?? "-"} ${headers["x-robots-tag"]}`;
      }),
    );
    expect(answers).toMatchInlineSnapshot(`
      [
        "404 no-store Site not found - noindex",
        "404 no-store Site not found - noindex",
        "404 no-store Site not found - noindex",
        "404 no-store Site not found - noindex",
        "404 no-store Site not found * noindex",
      ]
    `);
  });

  it("lets the share page read canvas.json's 404 for a site with nothing published yet", async () => {
    await env.DB.prepare("INSERT INTO site (id, owner_id, slug, title) VALUES ('site-empty', 'u1', 'empty', 'empty')").run();

    expect({
      canvas: await get("https://empty.sites.test/canvas.json"),
      preview: await get("https://empty.sites.test/preview"),
    }).toMatchInlineSnapshot(`
      {
        "canvas": {
          "body": "Not found",
          "headers": {
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-robots-tag": "noindex",
          },
          "status": 404,
        },
        "preview": {
          "body": "Not found",
          "headers": {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-robots-tag": "noindex",
          },
          "status": 404,
        },
      }
    `);
  });

  describe("with sites-serving off", () => {
    afterEach(async () => {
      await flags.setFailing(false);
      await flags.clear("sites-serving");
    });

    it("answers every host with the unavailable page, before looking the site up", async () => {
      await publish("taken-down", { "preview.html": "preview", "canvas.json": "{}" });
      await flags.set("sites-serving", false);

      const page = await get("https://taken-down.sites.test/preview");
      const others = await Promise.all(
        [
          "https://taken-down.sites.test/", // not the redirect
          "https://nobody.sites.test/preview", // no such slug: never looked up
          "https://a.b.sites.test/", // can't name a site
        ].map(async (url) => {
          const { status, headers } = await get(url);
          return `${status} ${headers["content-type"]} ${headers["access-control-allow-origin"] ?? "-"} ${headers["x-robots-tag"]}`;
        }),
      );
      const canvas = await get("https://taken-down.sites.test/canvas.json");
      expect({
        page: { ...page, body: /<h1[^>]*>(.*)<\/h1>/.exec(page.body)?.[1] },
        others,
        canvas: { status: canvas.status, cors: canvas.headers["access-control-allow-origin"] },
      }).toMatchInlineSnapshot(`
        {
          "canvas": {
            "cors": "*",
            "status": 503,
          },
          "others": [
            "503 text/html; charset=utf-8 - noindex",
            "503 text/html; charset=utf-8 - noindex",
            "503 text/html; charset=utf-8 - noindex",
          ],
          "page": {
            "body": "Antidraw sites are temporarily unavailable.",
            "headers": {
              "cache-control": "no-store",
              "content-type": "text/html; charset=utf-8",
              "retry-after": "3600",
              "x-robots-tag": "noindex",
            },
            "status": 503,
          },
        }
      `);
    });

    it("serves sites when the flag can't be read", async () => {
      await publish("fails-open", { "preview.html": "still here" });
      await flags.setFailing(true);

      const { status, body } = await get("https://fails-open.sites.test/preview");
      expect(`${status} ${body}`).toBe("200 still here");
    });
  });

  // Last: it breaks D1 for a moment.
  it("answers 503 when D1 fails, readable from any origin for canvas.json", async () => {
    await env.DB.prepare("ALTER TABLE site RENAME TO site_away").run();
    try {
      // Slugs this isolate hasn't cached.
      expect({
        canvas: await get("https://uncached.sites.test/canvas.json"),
        preview: await get("https://uncached-too.sites.test/preview"),
      }).toMatchInlineSnapshot(`
        {
          "canvas": {
            "body": "Temporarily unavailable",
            "headers": {
              "access-control-allow-origin": "*",
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
              "retry-after": "1",
              "x-robots-tag": "noindex",
            },
            "status": 503,
          },
          "preview": {
            "body": "Temporarily unavailable",
            "headers": {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
              "retry-after": "1",
              "x-robots-tag": "noindex",
            },
            "status": 503,
          },
        }
      `);
    } finally {
      await env.DB.prepare("ALTER TABLE site_away RENAME TO site").run();
    }
  });
});

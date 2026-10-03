import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

// This Worker in workerd with the built app (dist/, see test/build-app.ts) as
// its static assets, via Wrangler's test harness. Published sites are a local
// server standing in for <slug>.antidraw.app: http://127.0.0.1:<port>/sites/<slug>/.

const sites: Record<string, { status: number; body: string }> = {
  "paper-shaders": { status: 200, body: JSON.stringify({ version: 1, name: "Paper Shaders", components: [], layouts: [] }) },
  "tricky-name": { status: 200, body: JSON.stringify({ version: 1, name: `<script>alert("hi")</script> & co`, components: [], layouts: [] }) },
  "no-name": { status: 200, body: JSON.stringify({ version: 1, components: [], layouts: [] }) },
  "site-down": { status: 503, body: "" },
};

let siteServer: Server;
let harness: ReturnType<typeof createTestHarness>;
// The harness's address: requests there meet static assets before the Worker,
// as on Cloudflare (getWorker().fetch goes to the Worker directly).
let origin: string;
beforeAll(async () => {
  siteServer = createServer((req, res) => {
    const slug = /^\/sites\/([^/]+)\/canvas\.json$/.exec(req.url ?? "")?.[1];
    const site = slug ? sites[slug] : undefined;
    res.writeHead(site?.status ?? 404, { "content-type": "application/json" }).end(site?.body ?? "");
  });
  await new Promise<void>((resolve) => siteServer.listen(0, "127.0.0.1", resolve));
  const { port } = siteServer.address() as AddressInfo;

  harness = createTestHarness({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    workers: [{ configPath: "./wrangler.jsonc", vars: { SITE_URL_PATTERN: `http://127.0.0.1:${port}/sites/*` } }],
  });
  origin = (await harness.listen()).url.origin;
}, 60_000);
afterAll(async () => {
  await harness?.close();
  siteServer?.close();
});

const unhash = (text: string) => text.replace(/-[\w-]{8}\.(js|css)/g, "-[hash].$1");

/** Status, the headers worth reviewing, and the page's <head> (or the body). */
async function get(path: string, init?: RequestInit) {
  const res = await fetch(`${origin}${path}`, { redirect: "manual", ...init });
  const headers = Object.fromEntries(
    ["content-type", "cache-control", "x-robots-tag", "etag"].flatMap((name) => {
      const value = res.headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
  const text = unhash(await res.text()).replaceAll(origin, "http://share");
  const head = /<head>([\s\S]*)<\/head>/.exec(text)?.[1]?.trim();
  return head === undefined
    ? { status: res.status, headers, body: text.trim() }
    : { status: res.status, headers, head };
}

describe("share page", () => {
  it("serves the app with the canvas's name in its <head>", async () => {
    expect(await get("/s/paper-shaders")).toMatchInlineSnapshot(`
      {
        "head": "<meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <!-- The Worker (src/worker) fills these in for each canvas. -->
          <title>Paper Shaders · Antidraw</title>
          <meta name="description" content="A canvas made with Antidraw." />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="Antidraw" />
          <meta property="og:title" content="Paper Shaders" />
          <meta property="og:description" content="A canvas made with Antidraw." />
          <meta property="og:url" content="http://share/s/paper-shaders" />
          <meta name="twitter:card" content="summary" />
          <script type="module" crossorigin src="/s/assets/index-[hash].js"></script>
          <link rel="stylesheet" crossorigin href="/s/assets/index-[hash].css">",
        "headers": {
          "cache-control": "public, max-age=0, must-revalidate",
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex",
        },
        "status": 200,
      }
    `);
  });

  it("escapes the name", async () => {
    const { head } = await get("/s/tricky-name/");
    expect(head?.split("\n").filter((line: string) => /title|og:url/.test(line))).toMatchInlineSnapshot(`
      [
        "    <title>&lt;script&gt;alert("hi")&lt;/script&gt; &amp; co · Antidraw</title>",
        "    <meta property="og:title" content="<script>alert(&quot;hi&quot;)</script> & co" />",
        "    <meta property="og:url" content="http://share/s/tricky-name/" />",
      ]
    `);
  });

  it("answers 404 for a slug with nothing published, still with the app", async () => {
    const { status, head } = await get("/s/nobody");
    expect({ status, title: /<title>.*<\/title>/.exec(head ?? "")?.[0] }).toMatchInlineSnapshot(`
      {
        "status": 404,
        "title": "<title>Antidraw</title>",
      }
    `);
  });

  it("serves the app with the default <head> when the site can't be read", async () => {
    const answers = await Promise.all(
      ["/s/site-down", "/s/no-name"].map(async (path) => {
        const { status, head } = await get(path);
        return `${status} ${/<title>.*<\/title>/.exec(head ?? "")?.[0]}`;
      }),
    );
    expect(answers).toMatchInlineSnapshot(`
      [
        "200 <title>Antidraw</title>",
        "200 <title>Untitled · Antidraw</title>",
      ]
    `);
  });

  it("serves the app's files as they are, without the Worker", async () => {
    const page = await get("/s/paper-shaders");
    const script = /src="(\/s\/assets\/[^"]+\.js)"/.exec(await (await fetch(`${origin}/s/paper-shaders`)).text())?.[1];
    const { status, headers } = await get(script!);
    expect({ page: page.status, script: { status, contentType: headers["content-type"], robots: headers["x-robots-tag"] } })
      .toMatchInlineSnapshot(`
        {
          "page": 200,
          "script": {
            "contentType": "text/javascript; charset=utf-8",
            "robots": undefined,
            "status": 200,
          },
        }
      `);
  });

  // /s/ itself is the app's index.html, served by static assets: the app,
  // saying there's no canvas there.
  it("answers 404 for anything else under /s/", async () => {
    const answers = await Promise.all(
      [
        ["/s/", "GET"],
        ["/s/a/b", "GET"],
        ["/s/Not_A_Slug", "GET"],
        ["/s/assets/missing.js", "GET"],
        ["/s/paper-shaders", "POST"],
      ].map(async ([path, method]) => `${method} ${path} → ${(await get(path!, { method })).status}`),
    );
    expect(answers).toMatchInlineSnapshot(`
      [
        "GET /s/ → 200",
        "GET /s/a/b → 404",
        "GET /s/Not_A_Slug → 404",
        "GET /s/assets/missing.js → 404",
        "POST /s/paper-shaders → 404",
      ]
    `);
  });
});

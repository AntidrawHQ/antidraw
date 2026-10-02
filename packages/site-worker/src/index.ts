// Serves published sites: <slug>.<SITE_DOMAIN>/<path>. The slug names a site
// in D1, whose permanent id keys its files in R2, and SiteServer does the rest
// (@antidraw/site-upload). @antidraw/server writes both; this Worker only reads.
//
// A site is a workspace's built components (preview.html and its assets) and
// its canvas.json, not a page to visit: the canvas that shows them is the
// share page (SHARE_URL_PATTERN, on antidraw.com), which loads canvas.json
// from here and each component in an iframe of /preview. So / sends visitors
// to the share page, and canvas.json may be read from any origin.
//
// Each site gets its own subdomain, so its own origin: one site's code cannot
// read another's storage, and none of it runs on the product's domain
// (antidraw.com). Cookies are the exception: until antidraw.app is on the
// Public Suffix List, sibling subdomains are same-site, and a site can set a
// cookie on .antidraw.app that every other site receives. Sites are static
// and read no cookies, so nothing served here acts on one.
import { SiteServer, SiteStore, type FileCache } from "@antidraw/site-upload/server";

export interface Env {
  DB: D1Database;
  SITES: R2Bucket;
  SITE_DOMAIN: string;
  // A site's share page, with * for its slug: https://antidraw.com/s/*
  SHARE_URL_PATTERN: string;
}

// A slug is one DNS label. Checked only to skip the D1 read for hosts that
// can't name a site (a.b.antidraw.app); the lookup would miss them anyway.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Slug -> site id, per isolate. A slug is never repointed while its site
// exists, so the minute only bounds how long a deleted site stays reachable. A
// miss is kept briefly, so a slug published moments ago appears quickly.
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 5_000;
const MAX_SLUGS = 1_000;
const slugs = new Map<string, { id: string | null; until: number }>();

async function siteIdFor(db: D1Database, slug: string, now: number): Promise<string | null> {
  const cached = slugs.get(slug);
  if (cached && cached.until > now) return cached.id;
  const row = await db.prepare("SELECT id FROM site WHERE slug = ?").bind(slug).first<{ id: string }>();
  const id = row?.id ?? null;
  slugs.delete(slug);
  if (slugs.size >= MAX_SLUGS) slugs.delete(slugs.keys().next().value!);
  slugs.set(slug, { id, until: now + (id ? HIT_TTL_MS : MISS_TTL_MS) });
  return id;
}

// canvas.json may be read from any origin (see fetch below), and that includes
// its 404: the share page tells a slug with nothing published from a failure.
const cors = (pathname: string, headers: Headers) => {
  if (pathname === "/canvas.json") headers.set("access-control-allow-origin", "*");
};

const plain = (pathname: string, status: number, body: string, headers: Record<string, string> = {}) => {
  const response = new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });
  cors(pathname, response.headers);
  return response;
};

const notFound = (pathname: string) => plain(pathname, 404, "Site not found");

// One server per isolate, so its pointer cache lasts across requests.
let server: SiteServer | undefined;

export default {
  async fetch(request, env, ctx) {
    const { hostname: host, pathname } = new URL(request.url);
    const suffix = `.${env.SITE_DOMAIN}`;
    const slug = host.endsWith(suffix) ? host.slice(0, -suffix.length) : "";
    if (!SLUG_RE.test(slug)) return notFound(pathname);
    let siteId: string | null;
    try {
      siteId = await siteIdFor(env.DB, slug, Date.now());
    } catch (error) {
      // D1 failed: answer as SiteServer does when R2 fails, a 503 the share
      // page can see and retry, not the runtime's error page.
      console.error(error);
      return plain(pathname, 503, "Temporarily unavailable", { "retry-after": "1" });
    }
    if (!siteId) return notFound(pathname);

    if (pathname === "/") {
      // 302: where the share page lives may change.
      return new Response(null, {
        status: 302,
        headers: { location: env.SHARE_URL_PATTERN.replace("*", slug), "cache-control": "no-store" },
      });
    }

    server ??= new SiteServer({
      store: new SiteStore({ bucket: env.SITES }),
      cache: (caches as unknown as { default: FileCache }).default,
    });
    const response = await server.fetch(request, siteId, ctx);
    // Public, and fetched without credentials, so any origin will do: the
    // share page, and the web canvas's dev server and preview deployments.
    cors(pathname, response.headers);
    return response;
  },
} satisfies ExportedHandler<Env>;

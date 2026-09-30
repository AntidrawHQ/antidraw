// The share page at antidraw.com/s/<slug>. Workers static assets serves the
// app's files (dist/s/) before this Worker runs; everything else under /s/
// reaches it. For /s/<slug> it answers with the app's page, its <head> filled
// in from the site's canvas.json, so links to a canvas unfurl with its name.
import { siteFor, slugFromPath } from "../site";

export interface Env {
  ASSETS: Fetcher;
  // A site's base URL, * being its slug: https://*.antidraw.app
  SITE_URL_PATTERN: string;
}

// The site's name, or null when it isn't published. Undefined when that can't
// be told (the site didn't answer): the page is served as-is, and the app
// retries.
async function canvasName(url: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    const file: { name?: unknown } = await res.json();
    return typeof file.name === "string" && file.name ? file.name : "Untitled";
  } catch {
    return undefined;
  }
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const slug = slugFromPath(url.pathname);
    if (!slug || (request.method !== "GET" && request.method !== "HEAD")) return notFound();

    const [name, page] = await Promise.all([
      canvasName(siteFor(env.SITE_URL_PATTERN, slug).canvasFile),
      env.ASSETS.fetch(new URL("/s/", url)),
    ]);
    if (!page.ok) return page;

    const title = name ? `${name} · Antidraw` : "Antidraw";
    const rewritten = new HTMLRewriter()
      .on("title", { element: (el) => void el.setInnerContent(title) })
      .on('meta[property="og:title"]', { element: (el) => void el.setAttribute("content", name ?? "Antidraw") })
      .on('meta[property="og:url"]', { element: (el) => void el.setAttribute("content", `${url.origin}${url.pathname}`) })
      .transform(page);

    const headers = new Headers(page.headers);
    headers.delete("etag");
    headers.delete("content-length");
    headers.set("cache-control", "public, max-age=0, must-revalidate");
    // Published sites are anyone's code, unreviewed: kept out of search
    // results until there's a way to tell which ones to trust.
    headers.set("x-robots-tag", "noindex");
    // An unpublished slug still gets the app, which says there's nothing here.
    return new Response(request.method === "HEAD" ? null : rewritten.body, {
      status: name === null ? 404 : 200,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;

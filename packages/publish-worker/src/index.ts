// Serves published sites out of R2: <publish id>.<SITE_DOMAIN>/<path> reads
// <publish id>/<file> from the SITES bucket. A site is the directory that
// packages/shell/scripts/site.ts builds, and it expects to be the root of its
// origin: the viewer at /, the workspace's Preview page at /preview, and
// everything else a file (components refer to public files as "/clip.mp4").
//
// Each site gets its own subdomain so that one site's code can never read
// another's storage or cookies, on a domain of its own so that none of it
// runs on the product's (antidraw.com).

interface Env {
  SITES: R2Bucket;
  SITE_DOMAIN: string;
}

// A publish id is one DNS label.
const PUBLISH_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const siteFile = (pathname: string) =>
  pathname === "/" ? "index.html" : pathname === "/preview" ? "preview.html" : pathname.slice(1);

// Build output is content-hashed and uploaded with an immutable Cache-Control;
// anything uploaded without one (pages, canvas.json, public files) may change
// when the site is published again.
const DEFAULT_CACHE_CONTROL = "public, max-age=60";

const text = (status: number, body: string, headers?: HeadersInit) =>
  new Response(body, { status, headers });

// R2Range is a union, but the object R2 hands back can carry all three keys
// with the unused ones undefined, so test values rather than keys.
const contentRange = (range: R2Range, size: number) => {
  const { offset, length, suffix } = range as { offset?: number; length?: number; suffix?: number };
  if (suffix !== undefined) return `bytes ${size - suffix}-${size - 1}/${size}`;
  const start = offset ?? 0;
  const end = length === undefined ? size - 1 : start + length - 1;
  return `bytes ${start}-${end}/${size}`;
};

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method not allowed", { Allow: "GET, HEAD" });
    }

    const url = new URL(request.url);
    const suffix = `.${env.SITE_DOMAIN}`;
    const id = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : "";
    if (!PUBLISH_ID_RE.test(id)) return text(404, "Not found");

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return text(400, "Bad request");
    }
    const key = `${id}/${siteFile(pathname)}`;

    const headersFor = (object: R2Object) => {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", DEFAULT_CACHE_CONTROL);
      return headers;
    };

    if (request.method === "HEAD") {
      const object = await env.SITES.head(key);
      if (!object) return text(404, "Not found");
      const headers = headersFor(object);
      headers.set("Content-Length", String(object.size));
      return new Response(null, { headers });
    }

    const object = await env.SITES.get(key, { range: request.headers, onlyIf: request.headers });
    if (!object) return text(404, "Not found");
    const headers = headersFor(object);

    // A get whose precondition failed returns the object without a body.
    if (!("body" in object)) {
      const conditional = request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since");
      return new Response(null, { status: conditional ? 304 : 412, headers });
    }

    if (object.range && request.headers.has("Range")) {
      headers.set("Content-Range", contentRange(object.range, object.size));
      return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { headers });
  },
} satisfies ExportedHandler<Env>;

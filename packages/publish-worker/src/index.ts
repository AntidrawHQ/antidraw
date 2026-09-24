// Serves published sites out of R2: <publish id>.<SITE_DOMAIN>/<path> reads
// <publish id>/<file> from the SITES bucket. A site is the directory that
// packages/shell/scripts/site.ts builds, and it expects to be the root of its
// origin: the viewer at /, the workspace's Preview page at /preview, and
// everything else a file (components refer to public files as "/clip.mp4").
//
// Each site gets its own subdomain, so its own origin: one site's code cannot
// read another's storage, and none of it runs on the product's domain
// (antidraw.com). Cookies are the exception: until antidraw.app is on the
// Public Suffix List, sibling subdomains are same-site, and a site can set a
// cookie on .antidraw.app that every other site receives. Sites are static
// and read no cookies, so nothing served here acts on one.

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

type ByteRange = { offset: number; length: number };

// A Range header, against an object of `size` bytes: the one byte range it
// asks for, "unsatisfiable" (416), or null to answer with the whole object
// (no Range, one this does not parse, or several ranges, which a 200 may
// answer).
const parseRange = (header: string | null, size: number): ByteRange | "unsatisfiable" | null => {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    // bytes=-N: the last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (match[2] && Number(match[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { offset: start, length: end - start + 1 };
};

// If-Range names the version a client holds part of; a range from any other
// version would be spliced onto it, so then the answer is the whole object.
// Only the ETag is compared: no Last-Modified goes out, so a date there is not
// one of ours.
const ifRangeMatches = (ifRange: string | null, object: R2Object) =>
  ifRange === null || ifRange === object.httpEtag;

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
    // Longer than any key R2 can hold, so not a file of the site.
    if (new TextEncoder().encode(key).length > 1024) return text(404, "Not found");

    const headersFor = (object: R2Object) => {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", DEFAULT_CACHE_CONTROL);
      return headers;
    };

    try {
      if (request.method === "HEAD") {
        const object = await env.SITES.head(key);
        if (!object) return text(404, "Not found");
        const headers = headersFor(object);
        headers.set("Content-Length", String(object.size));
        return new Response(null, { headers });
      }

      // The range is worked out here against the object's size, rather than
      // handed to R2 as the request's headers: R2 answers a range it cannot
      // serve with the whole object, which would go out as a 206.
      const rangeHeader = request.headers.get("Range");
      let range: ByteRange | "unsatisfiable" | null = null;
      if (rangeHeader) {
        const object = await env.SITES.head(key);
        if (!object) return text(404, "Not found");
        if (ifRangeMatches(request.headers.get("If-Range"), object)) {
          range = parseRange(rangeHeader, object.size);
        }
        if (range === "unsatisfiable") {
          const headers = headersFor(object);
          headers.set("Content-Range", `bytes */${object.size}`);
          return new Response(null, { status: 416, headers });
        }
      }

      const object = await env.SITES.get(key, {
        onlyIf: request.headers,
        ...(range ? { range } : {}),
      });
      if (!object) return text(404, "Not found");
      const headers = headersFor(object);

      // A get whose precondition failed returns the object without a body.
      if (!("body" in object)) {
        const conditional = request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since");
        return new Response(null, { status: conditional ? 304 : 412, headers });
      }

      if (range) {
        // The object may have been replaced since the head above; its size
        // now is what the range has to fit.
        const end = Math.min(range.offset + range.length, object.size) - 1;
        if (range.offset > end) {
          headers.set("Content-Range", `bytes */${object.size}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set("Content-Range", `bytes ${range.offset}-${end}/${object.size}`);
        return new Response(object.body, { status: 206, headers });
      }
      return new Response(object.body, { headers });
    } catch (e) {
      // R2 being unavailable.
      console.error(key.slice(0, 200), e);
      return text(503, "Service unavailable", { "Retry-After": "5" });
    }
  },
} satisfies ExportedHandler<Env>;

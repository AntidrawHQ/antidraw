// Serves published sites out of R2: <slug>.<SITE_DOMAIN>/<path> looks the
// path up in the site's pointer, m/<slug>.json (see pointer.ts), and answers
// with the content that entry names, c/<owner id>/<sha256>. A path the
// pointer does not list is a 404: nothing is ever read from R2 by request
// path (a miss only re-checks the pointer, see MISS_REVALIDATE_MS). A site is the directory that packages/shell builds (scripts/site.ts,
// the app's Publish), and it expects to be the root of its origin: the viewer
// at /, the workspace's Preview page at /preview, and everything else a file
// (components refer to public files as "/clip.mp4").
//
// Each site gets its own subdomain, so its own origin: one site's code cannot
// read another's storage, and none of it runs on the product's domain
// (antidraw.com). Cookies are the exception: until antidraw.app is on the
// Public Suffix List, sibling subdomains are same-site, and a site can set a
// cookie on .antidraw.app that every other site receives. Sites are static
// and read no cookies, so nothing served here acts on one.

import {
  contentKey,
  createPointerCache,
  entryFor,
  MISS_REVALIDATE_MS,
  type PointerCache,
  type PointerEntry,
} from "./pointer";

export interface Env {
  SITES: R2Bucket;
  SITE_DOMAIN: string;
}

// A slug is one DNS label.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Percent-decoding that leaves a "%" that starts no valid escape as it is
// ("/100%.png"), as Vite's dev server does, rather than refusing the path.
const decodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname.replace(/(?:%[0-9A-Fa-f]{2})+/g, (escapes) => {
      try {
        return decodeURIComponent(escapes);
      } catch {
        return escapes;
      }
    });
  }
};

// The site's routes: the viewer at /, the workspace's Preview page at
// /preview, and every other path is a file.
export const siteFile = (pathname: string) =>
  pathname === "/" ? "index.html" : pathname === "/preview" ? "preview.html" : pathname.slice(1);

// The files whose name changes with their content, cached for a year: those
// the pointer marks immutable ("i", which the build decides), and only where
// such files are named: the viewer's build (_antidraw/) and the workspace
// build's hashed output, which the publish build names assets/[name]-[hash]
// with Rollup's 8-character hash (HASHED_NAME_RE in
// packages/shell/src/publish/site-build.ts). The name alone is not enough: a
// public file (public/assets/logo-original.png) can look hashed and still be
// replaced on the next publish. Anything else (pages, canvas.json, public
// files) may change when the site is published again.
const HASHED_NAME_RE = /^assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const DEFAULT_CACHE_CONTROL = "public, max-age=60";
export const cacheControlFor = (path: string, immutable: boolean) =>
  immutable && (path.startsWith("_antidraw/") || HASHED_NAME_RE.test(path))
    ? IMMUTABLE_CACHE_CONTROL
    : DEFAULT_CACHE_CONTROL;

const text = (status: number, body: string, headers?: HeadersInit) =>
  new Response(body, { status, headers });
// A 404 may be the moment before a publish reaches this isolate (see
// MISS_REVALIDATE_MS), so no cache keeps it.
const notFound = () => text(404, "Not found", { "Cache-Control": "no-store" });

// A file's validators: its strong ETag is the sha256 of its content, and its
// modification date is when the pointer that serves it was written (it cannot
// have changed since). The date is not sent as Last-Modified; it only answers
// If-Modified-Since and If-Unmodified-Since.
type Validators = { etag: string; written: Date };

// The conditional headers kept, when they are well formed: HTTP says to
// ignore a malformed one.
const ETAG_LIST_RE = /^\s*(?:\*|(?:W\/)?"[^"]*"(?:\s*,\s*(?:W\/)?"[^"]*")*)\s*$/;
const conditionalHeaders = (request: Request) => {
  const headers = new Headers();
  for (const name of ["If-Match", "If-None-Match"]) {
    const value = request.headers.get(name);
    if (value !== null && ETAG_LIST_RE.test(value)) headers.set(name, value);
  }
  for (const name of ["If-Modified-Since", "If-Unmodified-Since"]) {
    const value = request.headers.get(name);
    if (value !== null && !Number.isNaN(Date.parse(value))) headers.set(name, value);
  }
  return headers;
};

// The status a request's preconditions give, or null when they pass, in
// RFC 9110's order: If-Match (or else If-Unmodified-Since) failing is a 412;
// If-None-Match (or else If-Modified-Since) matching is a 304. Dates compare
// by the second, as HTTP dates carry no more.
const etagsIn = (value: string) => value.split(",").map((tag) => tag.trim());
const weak = (tag: string) => tag.replace(/^W\//, "");
const second = (date: Date) => Math.floor(date.getTime() / 1000);
const dateSecond = (value: string) => Math.floor(Date.parse(value) / 1000);

const failedPrecondition = (conditions: Headers, file: Validators): 304 | 412 | null => {
  const ifMatch = conditions.get("If-Match");
  const ifUnmodifiedSince = conditions.get("If-Unmodified-Since");
  if (ifMatch !== null) {
    // A strong comparison: a weak tag never matches.
    if (ifMatch.trim() !== "*" && !etagsIn(ifMatch).includes(file.etag)) return 412;
  } else if (ifUnmodifiedSince !== null && second(file.written) > dateSecond(ifUnmodifiedSince)) {
    return 412;
  }

  const ifNoneMatch = conditions.get("If-None-Match");
  const ifModifiedSince = conditions.get("If-Modified-Since");
  if (ifNoneMatch !== null) {
    const matches =
      ifNoneMatch.trim() === "*" || etagsIn(ifNoneMatch).some((tag) => weak(tag) === file.etag);
    if (matches) return 304;
  } else if (ifModifiedSince !== null && second(file.written) <= dateSecond(ifModifiedSince)) {
    return 304;
  }
  return null;
};

type ByteRange = { offset: number; length: number };

// A Range header, against a file of `size` bytes: the one byte range it asks
// for, "unsatisfiable" (416), or null to answer with the whole file (no
// Range, one this does not parse, or several ranges, which a 200 may answer).
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
// version would be spliced onto it, so then the answer is the whole file.
// Only the ETag is compared: no Last-Modified goes out, so a date there is not
// one of ours.
const ifRangeMatches = (ifRange: string | null, etag: string) =>
  ifRange === null || ifRange.trim() === etag;

// Everything a response says about a file. Never the owner id.
const headersFor = (path: string, entry: PointerEntry, etag: string) =>
  new Headers({
    "Content-Type": entry.t,
    ETag: etag,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControlFor(path, entry.i),
  });

export const createWorker = (pointers: PointerCache = createPointerCache()) =>
  ({
    async fetch(request, env): Promise<Response> {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return text(405, "Method not allowed", { Allow: "GET, HEAD" });
      }

      const url = new URL(request.url);
      const suffix = `.${env.SITE_DOMAIN}`;
      const slug = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : "";
      if (!SLUG_RE.test(slug)) return notFound();
      const path = siteFile(decodePath(url.pathname));

      try {
        let loaded = await pointers.load(env.SITES, slug);
        if (!loaded.pointer || entryFor(loaded.pointer, path) === undefined) {
          // The cached pointer may be up to REVALIDATE_MS old, and another
          // isolate may already have served the new version's page, which
          // names files (its hashed chunks) only the new pointer has. So a
          // miss asks R2 again before it is a 404, unless the cached copy was
          // checked moments ago.
          loaded = await pointers.load(env.SITES, slug, { maxAgeMs: MISS_REVALIDATE_MS });
        }
        const { pointer, written } = loaded;
        if (!pointer || !written) return notFound();
        const entry = entryFor(pointer, path);
        if (entry === undefined) return notFound();
        if (entry === "malformed") throw new Error("malformed pointer entry");

        const etag = `"${entry.h}"`;
        const headers = headersFor(path, entry, etag);
        const failed = failedPrecondition(conditionalHeaders(request), { etag, written });
        if (failed) return new Response(null, { status: failed, headers });

        if (request.method === "HEAD") {
          // Range is defined for GET only; a HEAD answers for the whole file.
          headers.set("Content-Length", String(entry.s));
          return new Response(null, { headers });
        }

        // Contents are immutable, so the range is worked out from the
        // pointer's size, with no read before the one that serves it (and R2
        // is never handed a range it would answer with the whole object).
        let range: ByteRange | "unsatisfiable" | null = null;
        const rangeHeader = request.headers.get("Range");
        if (rangeHeader && ifRangeMatches(request.headers.get("If-Range"), etag)) {
          range = parseRange(rangeHeader, entry.s);
        }
        if (range === "unsatisfiable") {
          headers.set("Content-Range", `bytes */${entry.s}`);
          return new Response(null, { status: 416, headers });
        }

        const object = await env.SITES.get(
          contentKey(pointer.u, entry.h),
          range ? { range } : undefined,
        );
        if (!object) {
          // The pointer names content that is not there: a bug upstream, not
          // something a retry mends.
          console.error(`missing content for ${slug}/${path.slice(0, 200)}`);
          return notFound();
        }
        if (range) {
          const end = range.offset + range.length - 1;
          headers.set("Content-Range", `bytes ${range.offset}-${end}/${entry.s}`);
          return new Response(object.body, { status: 206, headers });
        }
        return new Response(object.body, { headers });
      } catch (e) {
        // R2 being unavailable, a pointer that cannot be read, or pointer
        // loads at their memory budget (PointerBusyError), for a site not
        // cached here (a cached one is served as cached for a while, see
        // MAX_STALE_MS). The log names the site, never the owner id in the
        // content key.
        console.error(`${slug}/${path.slice(0, 200)}`, e);
        return text(503, "Service unavailable", { "Retry-After": "5" });
      }
    },
  }) satisfies ExportedHandler<Env>;

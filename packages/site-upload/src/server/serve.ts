import mime from "mime";
import { isId, type FileEntry } from "../protocol/manifest";
import { ifNoneMatchHits, ifRangeAllows, parseRange, type ByteRange } from "./http-conditions";
import type { Pointer, SiteStore } from "./store";

/**
 * "404-page": serve 404.html with status 404 when the site has one.
 * "single-page-application": serve index.html for unknown paths without a file extension.
 */
export type NotFoundMode = "404-page" | "single-page-application";

/** The slice of the Workers Cache API used here; `caches.default` fits it. */
export interface FileCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** The Worker's ExecutionContext, used to fill the cache after responding. */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export type SiteServerOptions = {
  store: SiteStore;
  /**
   * Where file bytes are cached, keyed by hash; usually `caches.default`.
   * Off unless given: the Cache API only works on a custom domain or route,
   * and elsewhere (workers.dev) each miss would cost an extra full R2 read.
   */
  cache?: FileCache | null;
  /** How long an isolate reuses a site's pointer before reading it again. Default 5 s. */
  pointerTtlMs?: number;
  /** Pointers kept in memory, least recently used dropped first. Default 500. */
  maxCachedSites?: number;
  /** Total stored size of the pointers kept in memory. Default 32 MiB. */
  maxCachedPointerBytes?: number;
  notFound?: NotFoundMode;
  /**
   * The Cache-Control for a file served with 200 (or 304). `immutable` is
   * this server's own choice: the upload's `i` flag, except on HTML, directory
   * indexes and the single-page-application fallback. Return e.g.
   * `"private, no-cache"` for a site only some viewers may see. Default:
   * a year for immutable files, else revalidate on every use.
   */
  cacheControl?: (file: { site: string; path: string; immutable: boolean }) => string;
  /**
   * Whether `site` may run service workers. Default false: a service worker
   * script request (`Service-Worker: script`) gets a script that unregisters
   * whatever worker is installed. When allowed, only a live file is served as
   * one; any other path gets the same script, so a worker left by an earlier
   * publish or a slug's previous owner goes away on its next update check.
   */
  serviceWorkers?: boolean | ((site: string) => boolean);
  now?: () => number;
};

type CachedPointer = { pointer: Pointer | null; fetchedAt: number; bytes: number };

type Resolved =
  | { kind: "file"; path: string; entry: FileEntry }
  | { kind: "redirect" }
  | { kind: "miss" };

// A miss re-reads a pointer older than this: a page from a just-published
// version asks for files an isolate holding the old pointer doesn't know yet.
const MISS_REFRESH_MS = 1000;

// Hashes filled into the cache by this isolate, so each is filled once.
const FILLED_MAX = 10_000;

const IMMUTABLE = "public, max-age=31536000, immutable";
// Cache keys name file content, not a site or path, so any site serving the
// same bytes shares the entry. The pointer still decides what a site can reach.
const CACHE_ORIGIN = "https://site-upload.cache";
const REVALIDATE = "public, max-age=0, must-revalidate";

// Sent for service worker scripts that aren't allowed or aren't live. A 404
// only fails the update check and leaves the old worker in control; this
// replaces it with one that unregisters itself and reloads the pages it ran.
const UNREGISTER_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url)))),
  );
});
`;

export class SiteServer {
  private readonly store: SiteStore;
  private readonly pointerTtlMs: number;
  private readonly maxCachedSites: number;
  private readonly notFound: NotFoundMode;
  private readonly now: () => number;
  private readonly cacheControl: NonNullable<SiteServerOptions["cacheControl"]>;
  private readonly serviceWorkers: (site: string) => boolean;
  private readonly maxCachedPointerBytes: number;
  private readonly pointers = new Map<string, CachedPointer>();
  private readonly loading = new Map<string, Promise<CachedPointer>>();
  private cachedPointerBytes = 0;
  private readonly cache: FileCache | null;
  private readonly filling = new Map<string, Promise<void>>();
  private readonly filled = new Set<string>();

  constructor(options: SiteServerOptions) {
    this.store = options.store;
    this.cache = options.cache ?? null;
    this.pointerTtlMs = options.pointerTtlMs ?? 5000;
    this.maxCachedSites = options.maxCachedSites ?? 500;
    this.maxCachedPointerBytes = options.maxCachedPointerBytes ?? 32 * 1024 * 1024;
    this.notFound = options.notFound ?? "404-page";
    this.now = options.now ?? Date.now;
    this.cacheControl = options.cacheControl ?? (({ immutable }) => (immutable ? IMMUTABLE : REVALIDATE));
    const serviceWorkers = options.serviceWorkers ?? false;
    this.serviceWorkers = typeof serviceWorkers === "function" ? serviceWorkers : () => serviceWorkers;
  }

  /**
   * Answers a GET or HEAD for `site`, taking the file path from the request
   * URL. Pass the Worker's ExecutionContext so cache misses fill the cache.
   * Never throws: storage failures become a 503.
   */
  async fetch(request: Request, site: string, ctx?: WaitUntil): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method not allowed", { allow: "GET, HEAD" });
    }
    if (!isId(site)) return text(404, "Not found");
    const url = new URL(request.url);
    const path = decodePath(url.pathname);
    if (path === null) return text(400, "Bad request");
    if (workerScript(request) && !this.serviceWorkers(site)) return unregisterWorker();

    try {
      let cached = await this.pointer(site, false);
      let resolved = resolve(cached.pointer, path);
      if (resolved.kind === "miss" && this.now() - cached.fetchedAt >= MISS_REFRESH_MS) {
        cached = await this.pointer(site, true);
        resolved = resolve(cached.pointer, path);
      }
      const response = await this.respond(request, site, url, path, cached.pointer, resolved, ctx);
      if (response) return response;

      // The file is gone from storage: cleanup ran after a newer version went
      // live, so this pointer is out of date. Read it again and retry once.
      cached = await this.pointer(site, true);
      resolved = resolve(cached.pointer, path);
      return (
        (await this.respond(request, site, url, path, cached.pointer, resolved, ctx)) ?? unavailable()
      );
    } catch {
      return unavailable();
    }
  }

  /** Drops a cached pointer, e.g. right after committing from the same isolate. */
  forget(site: string) {
    const cached = this.pointers.get(site);
    if (!cached) return;
    this.pointers.delete(site);
    this.cachedPointerBytes -= cached.bytes;
  }

  /** The response for a resolved path, or null if its file is missing from storage. */
  private async respond(
    request: Request,
    site: string,
    url: URL,
    path: string,
    pointer: Pointer | null,
    resolved: Resolved,
    ctx: WaitUntil | undefined,
  ): Promise<Response | null> {
    if (workerScript(request) && !(resolved.kind === "file" && pointer?.files[resolved.path] === resolved.entry)) {
      // Not a live file (missing, a redirect, or a retained old version).
      return unregisterWorker();
    }
    if (!pointer) return text(404, "Not found");
    if (resolved.kind === "file") return this.serve(request, site, resolved.path, resolved.entry, 200, ctx);
    if (resolved.kind === "redirect") {
      return new Response(null, {
        status: 308,
        headers: { location: `${url.pathname}/${url.search}`, "cache-control": REVALIDATE },
      });
    }

    if (this.notFound === "single-page-application" && !lastSegment(path).includes(".")) {
      const index = pointer.files["index.html"];
      if (index) return this.serve(request, site, "index.html", index, 200, ctx);
    }
    const page = pointer.files["404.html"];
    if (this.notFound === "404-page" && page) return this.serve(request, site, "404.html", page, 404, ctx);
    return text(404, "Not found");
  }

  private async serve(
    request: Request,
    site: string,
    path: string,
    entry: FileEntry,
    status: 200 | 404,
    ctx: WaitUntil | undefined,
  ): Promise<Response | null> {
    const etag = `"${entry.h}"`;
    const type = contentType(path);
    const headers = new Headers({ "content-type": type, "x-content-type-options": "nosniff" });

    let range: ByteRange | null = null;
    if (status === 200) {
      // `i` comes from the uploader. Pages (directory indexes and the
      // single-page-application fallback included) sit at URLs every publish
      // reuses, so pinning one in browsers for a year would outlive later
      // publishes, by a teammate or a slug's next owner, with no way to purge it.
      const immutable = entry.i === true && !isPage(type);
      headers.set("etag", etag);
      headers.set("cache-control", this.cacheControl({ site, path, immutable }));
      headers.set("accept-ranges", "bytes");
      if (ifNoneMatchHits(request.headers.get("if-none-match"), etag)) {
        headers.delete("content-type");
        return new Response(null, { status: 304, headers });
      }
      const rangeHeader = request.headers.get("range");
      if (rangeHeader !== null && ifRangeAllows(request.headers.get("if-range"), etag)) {
        const parsed = parseRange(rangeHeader, entry.s);
        if (parsed === "unsatisfiable") {
          headers.delete("content-type");
          headers.set("content-range", `bytes */${entry.s}`);
          return new Response(null, { status: 416, headers });
        }
        range = parsed;
      }
    } else {
      headers.set("cache-control", "no-store");
    }

    const length = range ? range.end - range.start + 1 : entry.s;
    headers.set("content-length", String(length));
    if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${entry.s}`);
    const finalStatus = range ? 206 : status;
    if (request.method === "HEAD") return new Response(null, { status: finalStatus, headers });

    const body = await this.fileBody(site, entry, range, ctx);
    if (!body) return null;
    return new Response(body, { status: finalStatus, headers });
  }

  /** A file's bytes (or a range of them), from the cache when it has them, else R2. */
  private async fileBody(
    site: string,
    entry: FileEntry,
    range: ByteRange | null,
    ctx: WaitUntil | undefined,
  ): Promise<ReadableStream | null> {
    const key = `${CACHE_ORIGIN}/${entry.h}`;
    if (this.cache) {
      const lookup = new Request(key, range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {});
      const hit = await this.cache.match(lookup).catch(() => undefined);
      // The cache answers a range with 206; anything else isn't the slice asked for.
      if (hit?.body && hit.status === (range ? 206 : 200)) return hit.body;
    }

    const object = await this.store.getFile(
      site,
      entry.h,
      range ? { offset: range.start, length: range.end - range.start + 1 } : undefined,
    );
    if (!object) return null;
    // The cache is filled with a second, full read after responding, rather
    // than by teeing this stream: a slow viewer would make tee buffer the file.
    if (this.cache && ctx && !this.filled.has(entry.h)) ctx.waitUntil(this.fill(site, entry, key));
    return object.body;
  }

  private fill(site: string, entry: FileEntry, key: string): Promise<void> {
    const running = this.filling.get(entry.h);
    if (running) return running;
    const cache = this.cache!;
    const filling = (async () => {
      const object = await this.store.getFile(site, entry.h);
      if (!object) return;
      // Content-Length lets the cache answer range requests itself.
      const response = new Response(object.body, {
        headers: {
          "content-length": String(entry.s),
          "cache-control": IMMUTABLE,
          etag: `"${entry.h}"`,
        },
      });
      await cache.put(new Request(key), response);
      if (this.filled.size >= FILLED_MAX) this.filled.clear();
      this.filled.add(entry.h);
    })()
      .catch(() => {})
      .finally(() => this.filling.delete(entry.h));
    this.filling.set(entry.h, filling);
    return filling;
  }

  /** The site's pointer from memory, or read once however many requests ask at the same time. */
  private async pointer(site: string, force: boolean): Promise<CachedPointer> {
    const hit = this.pointers.get(site);
    if (hit && !force && this.now() - hit.fetchedAt < this.pointerTtlMs) {
      this.pointers.delete(site);
      this.pointers.set(site, hit);
      return hit;
    }
    let loading = this.loading.get(site);
    if (!loading) {
      loading = this.store
        .readPointerSized(site)
        .then(({ pointer, bytes }) => {
          const fresh = { pointer, fetchedAt: this.now(), bytes };
          this.remember(site, fresh);
          return fresh;
        })
        .finally(() => this.loading.delete(site));
      this.loading.set(site, loading);
    }
    return loading;
  }

  private remember(site: string, fresh: CachedPointer) {
    this.forget(site);
    this.pointers.set(site, fresh);
    this.cachedPointerBytes += fresh.bytes;
    while (
      this.pointers.size > 1 &&
      (this.pointers.size > this.maxCachedSites || this.cachedPointerBytes > this.maxCachedPointerBytes)
    ) {
      this.forget(this.pointers.keys().next().value!);
    }
  }
}

function resolve(pointer: Pointer | null, path: string): Resolved {
  if (!pointer) return { kind: "miss" };
  const files = pointer.files;
  if (path === "" || path.endsWith("/")) {
    const index = `${path}index.html`;
    const entry = files[index];
    return entry ? { kind: "file", path: index, entry } : { kind: "miss" };
  }
  // Retained entries are the previous version's hashed chunks, still asked
  // for by pages opened before this version went live.
  const entry = files[path] ?? pointer.retained[path];
  if (entry) return { kind: "file", path, entry };
  if (files[`${path}/index.html`]) return { kind: "redirect" };
  return { kind: "miss" };
}

/** URL pathname → manifest path: percent-decoded, NFC, no leading slash. */
function decodePath(pathname: string): string | null {
  try {
    return pathname
      .slice(1)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
      .normalize("NFC");
  } catch {
    return null;
  }
}

/** The Content-Type Cloudflare's own static-asset serving would send for `path`. */
export function contentType(path: string): string {
  const type = mime.getType(path);
  if (!type) return "application/octet-stream";
  return type.startsWith("text/") && !type.includes("charset") ? `${type}; charset=utf-8` : type;
}

const isPage = (type: string) => /^(text\/html|application\/xhtml\+xml)\b/.test(type);

const unavailable = () => text(503, "Temporarily unavailable", { "retry-after": "1" });

const workerScript = (request: Request) => request.headers.get("service-worker") === "script";

const unregisterWorker = () =>
  new Response(UNREGISTER_WORKER, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
  });

const lastSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });

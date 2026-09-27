import type { FileEntry } from "../protocol/manifest";
import { contentType } from "./content-type";
import { ifNoneMatchHits, ifRangeAllows, parseRange, type ByteRange } from "./http-conditions";
import type { Pointer, SiteStore } from "./store";

/**
 * "404-page": serve 404.html with status 404 when the site has one.
 * "single-page-application": serve index.html for unknown paths without a file extension.
 */
export type NotFoundMode = "404-page" | "single-page-application";

export type SiteServerOptions = {
  store: SiteStore;
  /** How long an isolate reuses a site's pointer before reading it again. Default 5 s. */
  pointerTtlMs?: number;
  /** Pointers kept in memory, least recently used dropped first. Default 500. */
  maxCachedSites?: number;
  notFound?: NotFoundMode;
  now?: () => number;
};

type CachedPointer = { pointer: Pointer | null; fetchedAt: number };

type Resolved =
  | { kind: "file"; path: string; entry: FileEntry }
  | { kind: "redirect" }
  | { kind: "miss" };

// A miss re-reads a pointer older than this: a page from a just-published
// version asks for files an isolate holding the old pointer doesn't know yet.
const MISS_REFRESH_MS = 1000;

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

export class SiteServer {
  private readonly store: SiteStore;
  private readonly pointerTtlMs: number;
  private readonly maxCachedSites: number;
  private readonly notFound: NotFoundMode;
  private readonly now: () => number;
  private readonly pointers = new Map<string, CachedPointer>();

  constructor(options: SiteServerOptions) {
    this.store = options.store;
    this.pointerTtlMs = options.pointerTtlMs ?? 5000;
    this.maxCachedSites = options.maxCachedSites ?? 500;
    this.notFound = options.notFound ?? "404-page";
    this.now = options.now ?? Date.now;
  }

  /** Answers a GET or HEAD for `site`, taking the file path from the request URL. */
  async fetch(request: Request, site: string): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method not allowed", { allow: "GET, HEAD" });
    }
    const url = new URL(request.url);
    const path = decodePath(url.pathname);
    if (path === null) return text(400, "Bad request");

    let cached = await this.pointer(site, false);
    let resolved = resolve(cached.pointer, path);
    if (resolved.kind === "miss" && this.now() - cached.fetchedAt >= MISS_REFRESH_MS) {
      cached = await this.pointer(site, true);
      resolved = resolve(cached.pointer, path);
    }

    const pointer = cached.pointer;
    if (!pointer) return text(404, "Not found");
    if (resolved.kind === "file") return this.serve(request, site, resolved.path, resolved.entry, 200);
    if (resolved.kind === "redirect") {
      return new Response(null, {
        status: 308,
        headers: { location: `${url.pathname}/${url.search}`, "cache-control": REVALIDATE },
      });
    }

    if (this.notFound === "single-page-application" && !lastSegment(path).includes(".")) {
      const index = pointer.files["index.html"];
      if (index) return this.serve(request, site, "index.html", index, 200);
    }
    const page = pointer.files["404.html"];
    if (this.notFound === "404-page" && page) return this.serve(request, site, "404.html", page, 404);
    return text(404, "Not found");
  }

  /** Drops a cached pointer, e.g. right after committing from the same isolate. */
  forget(site: string) {
    this.pointers.delete(site);
  }

  private async serve(
    request: Request,
    site: string,
    path: string,
    entry: FileEntry,
    status: 200 | 404,
  ): Promise<Response> {
    const etag = `"${entry.h}"`;
    const headers = new Headers({
      "content-type": contentType(path),
      "x-content-type-options": "nosniff",
    });

    let range: ByteRange | null = null;
    if (status === 200) {
      headers.set("etag", etag);
      headers.set("cache-control", entry.i ? IMMUTABLE : REVALIDATE);
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

    const object = await this.store.getFile(
      site,
      entry.h,
      range ? { offset: range.start, length } : undefined,
    );
    if (!object) return text(503, "This file is temporarily unavailable");
    return new Response(object.body, { status: finalStatus, headers });
  }

  private async pointer(site: string, force: boolean): Promise<CachedPointer> {
    const hit = this.pointers.get(site);
    const now = this.now();
    if (hit && !force && now - hit.fetchedAt < this.pointerTtlMs) {
      this.pointers.delete(site);
      this.pointers.set(site, hit);
      return hit;
    }
    const fresh = { pointer: await this.store.readPointer(site), fetchedAt: now };
    this.pointers.delete(site);
    this.pointers.set(site, fresh);
    if (this.pointers.size > this.maxCachedSites) {
      this.pointers.delete(this.pointers.keys().next().value!);
    }
    return fresh;
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
  const entry = files[path];
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

const lastSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });

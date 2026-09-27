// A site's live pointer, m/<slug>.json in the SITES bucket: the manifest of
// every file the site serves, each by the sha256 of its content, which lives
// at c/<owner id>/<sha256>. Publishing writes a whole new pointer in one put,
// so a site switches from one version to the next atomically.
//
//   { "v": 1, "version": 7, "u": "<owner id>",
//     "files": { "index.html": { "h": "<sha256>", "s": 1234, "t": "text/html; charset=utf-8" } } }
//
// The owner id only names where the contents are; it never goes out in a
// response.

export type PointerEntry = { h: string; s: number; t: string };

export type Pointer = {
  v: 1;
  version: number;
  u: string;
  files: Record<string, unknown>;
};

export const pointerKey = (slug: string) => `m/${slug}.json`;
export const contentKey = (owner: string, sha256: string) => `c/${owner}/${sha256}`;

const SHA256_RE = /^[0-9a-f]{64}$/;
// An owner id is one key segment: never empty, never a "/" or a dot segment.
const OWNER_RE = /^[A-Za-z0-9_-]{1,128}$/;
// A Content-Type goes into a header as it is.
const CONTENT_TYPE_RE = /^[\x21-\x7e][\x20-\x7e]{0,254}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The pointer in `text`, or null when it is not one. Only the envelope is
// checked here; an entry is checked when a request asks for it (entryFor), so
// a 2 MB pointer is not walked on every load.
export const parsePointer = (text: string): Pointer | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1) return null;
  if (!Number.isSafeInteger(value.version) || typeof value.u !== "string") return null;
  if (!OWNER_RE.test(value.u) || !isRecord(value.files)) return null;
  return value as Pointer;
};

// The pointer's entry for a site path: undefined when the site has no such
// file, and "malformed" when the entry is not one. An own property only: the
// path "constructor" is not Object.prototype's.
export const entryFor = (
  pointer: Pointer,
  path: string,
): PointerEntry | "malformed" | undefined => {
  if (!Object.hasOwn(pointer.files, path)) return undefined;
  const entry = pointer.files[path];
  if (
    !isRecord(entry) ||
    typeof entry.h !== "string" ||
    !SHA256_RE.test(entry.h) ||
    !Number.isSafeInteger(entry.s) ||
    (entry.s as number) < 0 ||
    typeof entry.t !== "string" ||
    !CONTENT_TYPE_RE.test(entry.t)
  ) {
    return "malformed";
  }
  return { h: entry.h, s: entry.s as number, t: entry.t };
};

// What a load gives: the pointer (null when the site has none) and when it was
// written, which stands in for every file's modification date (a file of the
// site cannot have changed since the pointer that serves it was written).
export type LoadedPointer = { pointer: Pointer | null; written: Date | null };

type Cached = LoadedPointer & {
  etag: string | null;
  checkedAt: number;
  bytes: number;
};

// How long a cached pointer is served before R2 is asked whether it changed
// (a conditional get, which costs no body when it has not).
export const REVALIDATE_MS = 5_000;
// Pointers are up to ~2 MB; an isolate has 128 MB.
const MAX_CACHED_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_SITES = 1_000;

export class MalformedPointerError extends Error {}

// A per-isolate cache of pointers, keyed by slug. At most one R2 read per slug
// is in flight: requests that arrive while one is revalidating wait for it.
export const createPointerCache = (now: () => number = Date.now) => {
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();
  let cachedBytes = 0;

  const store = (slug: string, entry: Cached) => {
    const previous = cache.get(slug);
    if (previous) {
      cachedBytes -= previous.bytes;
      cache.delete(slug);
    }
    cache.set(slug, entry);
    cachedBytes += entry.bytes;
    // Oldest first: a Map iterates in insertion order, and a hit re-inserts.
    for (const [key, old] of cache) {
      if (cachedBytes <= MAX_CACHED_BYTES && cache.size <= MAX_CACHED_SITES) break;
      if (key === slug) continue;
      cache.delete(key);
      cachedBytes -= old.bytes;
    }
  };

  const refresh = async (bucket: R2Bucket, slug: string, cached: Cached | undefined) => {
    const etag = cached?.pointer ? cached.etag : null;
    const object = await bucket.get(
      pointerKey(slug),
      etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined,
    );
    let entry: Cached;
    if (object === null) {
      // No pointer: the site does not exist (or no longer does). Cached too,
      // so a stream of requests for a missing site does not each read R2.
      entry = { pointer: null, written: null, etag: null, checkedAt: now(), bytes: 0 };
    } else if (!("body" in object)) {
      // Unchanged since the cached copy.
      entry = { ...cached!, checkedAt: now() };
    } else {
      const text = await object.text();
      const pointer = parsePointer(text);
      if (!pointer) throw new MalformedPointerError(`pointer of ${slug} is malformed`);
      entry = {
        pointer,
        written: object.uploaded,
        etag: object.etag,
        checkedAt: now(),
        bytes: text.length,
      };
    }
    store(slug, entry);
    return entry;
  };

  const load = async (bucket: R2Bucket, slug: string): Promise<LoadedPointer> => {
    const cached = cache.get(slug);
    if (cached && now() - cached.checkedAt < REVALIDATE_MS) {
      // Most recently used goes last.
      cache.delete(slug);
      cache.set(slug, cached);
      return cached;
    }
    let pending = inflight.get(slug);
    if (!pending) {
      pending = refresh(bucket, slug, cached).finally(() => inflight.delete(slug));
      inflight.set(slug, pending);
    }
    return pending;
  };

  return { load, size: () => cache.size };
};

export type PointerCache = ReturnType<typeof createPointerCache>;

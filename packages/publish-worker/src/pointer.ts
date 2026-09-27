// A site's live pointer, m/<slug>.json in the SITES bucket: the manifest of
// every file the site serves, each by the sha256 of its content, which lives
// at c/<owner id>/<sha256>. Publishing writes a whole new pointer in one put,
// so a site switches from one version to the next atomically.
//
//   { "v": 1, "version": 7, "u": "<owner id>",
//     "files": { "index.html": { "h": "<sha256>", "s": 1234, "t": "text/html; charset=utf-8" },
//                "assets/index-AbC12345.js": { "h": "…", "s": 99, "t": "…", "i": 1 } } }
//
// "i": 1 marks a file the build named by its content (its hashed output, the
// viewer's _antidraw/ files), which may be cached for a year. The flag comes
// from the build, never from the name: a public file can look hashed
// (public/assets/logo-original.png) and still change on the next publish.
// Absent, a file is not immutable.
//
// The owner id only names where the contents are; it never goes out in a
// response.

export type PointerEntry = { h: string; s: number; t: string; i: boolean };

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
    !CONTENT_TYPE_RE.test(entry.t) ||
    (entry.i !== undefined && entry.i !== 0 && entry.i !== 1)
  ) {
    return "malformed";
  }
  return { h: entry.h, s: entry.s as number, t: entry.t, i: entry.i === 1 };
};

// What a load gives: the pointer (null when the site has none) and when it was
// written, which stands in for every file's modification date (a file of the
// site cannot have changed since the pointer that serves it was written).
export type LoadedPointer = { pointer: Pointer | null; written: Date | null };

type Cached = LoadedPointer & {
  etag: string | null;
  checkedAt: number;
  // What the parsed pointer is estimated to take of the heap.
  heap: number;
};

// How long a cached pointer is served before R2 is asked whether it changed
// (a conditional get, which costs no body when it has not).
export const REVALIDATE_MS = 5_000;
// A request for a path the cached pointer does not have asks R2 again first
// (serve.ts), once the cached copy is this old: another isolate may already
// have served the new version's page, which names files only the new pointer
// has. The floor bounds what a stream of real 404s costs: at most one
// conditional get per site per isolate this often, however many there are.
export const MISS_REVALIDATE_MS = 500;

// Memory. An isolate has 128 MB, shared by every request it serves, for any
// site. The server keeps a pointer under 2 MB (MAX_POINTER_BYTES in
// packages/server/src/lib/publish-limits.ts); one larger than this is refused
// unread, as a bug upstream.
export const MAX_POINTER_BYTES = 2_500_000;
// A parsed pointer takes about twice its text in heap (measured: 16 pointers
// of 2 MB held 61 MB), so the cache is charged 2.5 bytes per character.
export const cachedHeapOf = (text: string) => Math.ceil(text.length * 2.5);
export const MAX_CACHED_HEAP = 32 * 1024 * 1024;
const MAX_CACHED_SITES = 1_000;
// A load holds the text and the parsed pointer at once, before the cache
// evicts anything: charged 4 bytes per byte of the object, from its size and
// before its body is read. Loads of different sites run in parallel; past
// this many bytes between them a load is refused (a 503 the client retries)
// rather than risk the isolate. A single pointer of the largest size fits
// twice over.
export const loadingHeapOf = (size: number) => size * 4;
export const MAX_LOADING_HEAP = 24 * 1024 * 1024;

export class MalformedPointerError extends Error {}
// The loads in flight hold as much memory as they may: try again shortly.
export class PointerBusyError extends Error {}

// A per-isolate cache of pointers, keyed by slug. At most one R2 read per slug
// is in flight: requests that arrive while one is revalidating wait for it.
export const createPointerCache = (now: () => number = Date.now) => {
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();
  let cachedHeap = 0;
  let loadingHeap = 0;

  const store = (slug: string, entry: Cached) => {
    const previous = cache.get(slug);
    if (previous) {
      cachedHeap -= previous.heap;
      cache.delete(slug);
    }
    cache.set(slug, entry);
    cachedHeap += entry.heap;
    // Oldest first: a Map iterates in insertion order, and a hit re-inserts.
    for (const [key, old] of cache) {
      if (cachedHeap <= MAX_CACHED_HEAP && cache.size <= MAX_CACHED_SITES) break;
      if (key === slug) continue;
      cache.delete(key);
      cachedHeap -= old.heap;
    }
  };

  // Reads and parses a pointer's body, within the loading budget.
  const read = async (slug: string, object: R2ObjectBody) => {
    const discard = () => object.body.cancel().catch(() => {});
    if (object.size > MAX_POINTER_BYTES) {
      await discard();
      throw new MalformedPointerError(`pointer of ${slug} is ${object.size} bytes`);
    }
    const reserved = loadingHeapOf(object.size);
    if (loadingHeap + reserved > MAX_LOADING_HEAP) {
      await discard();
      throw new PointerBusyError(`pointer loads are at their memory budget (${slug})`);
    }
    loadingHeap += reserved;
    try {
      const text = await object.text();
      const pointer = parsePointer(text);
      if (!pointer) throw new MalformedPointerError(`pointer of ${slug} is malformed`);
      return { pointer, heap: cachedHeapOf(text) };
    } finally {
      loadingHeap -= reserved;
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
      entry = { pointer: null, written: null, etag: null, checkedAt: now(), heap: 0 };
    } else if (!("body" in object)) {
      // Unchanged since the cached copy.
      entry = { ...cached!, checkedAt: now() };
    } else {
      const { pointer, heap } = await read(slug, object);
      entry = { pointer, written: object.uploaded, etag: object.etag, checkedAt: now(), heap };
    }
    store(slug, entry);
    return entry;
  };

  // `maxAgeMs`: how long ago the cached copy may have been checked to be
  // served as it is (a request for a missing path passes MISS_REVALIDATE_MS).
  // A shorter one shares the read in flight like any other.
  const load = async (
    bucket: R2Bucket,
    slug: string,
    { maxAgeMs = REVALIDATE_MS }: { maxAgeMs?: number } = {},
  ): Promise<LoadedPointer> => {
    const cached = cache.get(slug);
    if (cached && now() - cached.checkedAt < maxAgeMs) {
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

  return {
    load,
    size: () => cache.size,
    cachedHeap: () => cachedHeap,
    loadingHeap: () => loadingHeap,
  };
};

export type PointerCache = ReturnType<typeof createPointerCache>;

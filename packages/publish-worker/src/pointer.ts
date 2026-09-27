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

// Unicode normalization. A pointer's paths are file names as the publishing
// machine's disk gave them, and macOS (Finder especially) stores accented
// names decomposed (NFD: "cafe\u0301.png"), while a page names the file as its
// source spells it, usually composed (NFC: "caf\u00e9.png"). The browser
// percent-encodes the path as written and nothing on the way normalizes it;
// Vite's dev server finds the file anyway because APFS ignores normalization,
// and `site.ts serve` matches by NFC form as this does. So a path the pointer
// does not list as it is is looked up by its NFC form among the pointer's
// paths by theirs, which also matches a path that mixes forms (a directory
// made in one, a file in the other). Two paths of the pointer that differ only in normalization are
// each served by their exact name, and neither by the other's.
const ASCII_RE = /^[\x00-\x7f]*$/;
// NFC form -> the pointer's path, or null when two paths share the form. Only
// non-ASCII paths (ASCII is the same in every form), built on the first
// lookup that needs it and kept as long as the pointer is.
const normalizedPaths = new WeakMap<Pointer, Map<string, string | null>>();
const normalizedPathsOf = (pointer: Pointer) => {
  let index = normalizedPaths.get(pointer);
  if (!index) {
    index = new Map();
    for (const path of Object.keys(pointer.files)) {
      if (ASCII_RE.test(path)) continue;
      const key = path.normalize("NFC");
      index.set(key, index.has(key) ? null : path);
    }
    normalizedPaths.set(pointer, index);
  }
  return index;
};

// The pointer's own path that serves `path`: itself, or the one that is the
// same in NFC (see above).
const pointerPathFor = (pointer: Pointer, path: string) => {
  if (Object.hasOwn(pointer.files, path)) return path;
  if (ASCII_RE.test(path)) return undefined;
  return normalizedPathsOf(pointer).get(path.normalize("NFC")) ?? undefined;
};

// The pointer's entry for a site path: undefined when the site has no such
// file, and "malformed" when the entry is not one. An own property only: the
// path "constructor" is not Object.prototype's. A path the pointer spells in
// another Unicode normalization form is the same file (pointerPathFor).
export const entryFor = (
  pointer: Pointer,
  requested: string,
): PointerEntry | "malformed" | undefined => {
  const path = pointerPathFor(pointer, requested);
  if (path === undefined) return undefined;
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
// A site's cached pointer.
type Cached = {
  pointer: Pointer;
  written: Date;
  etag: string;
  // When R2 was last asked, and when it last answered: they differ while a
  // stale copy is served (MAX_STALE_MS).
  checkedAt: number;
  confirmedAt: number;
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
// When asking R2 fails (R2 unavailable, the loads in flight at their memory
// budget, a new pointer that cannot be read), a site that is cached goes on
// being served as it was, and R2 is asked again a revalidation window later:
// a few seconds' more staleness rather than a 503. Only for this long after R2
// last answered for it; past that, the failure is the response.
export const MAX_STALE_MS = 60_000;

// Memory. An isolate has 128 MB, shared by every request it serves, for any
// site. The server keeps a pointer under 2 MB (MAX_POINTER_BYTES in
// packages/server/src/lib/publish-limits.ts); one larger than this is refused
// unread, as a bug upstream.
export const MAX_POINTER_BYTES = 2_500_000;
// A parsed pointer takes about twice its text in heap (measured: 16 pointers
// of 2 MB held 61 MB), so the cache is charged 2.5 bytes per character.
export const cachedHeapOf = (text: string) => Math.ceil(text.length * 2.5);
export const MAX_CACHED_HEAP = 32 * 1024 * 1024;
export const MAX_CACHED_SITES = 1_000;
// One owner's sites share at most this much of the cache (two pointers of the
// largest size), so one account's large pointers cannot push every other
// site out: past it, that owner's least recently used site goes first.
export const MAX_OWNER_CACHED_HEAP = 12 * 1024 * 1024;
// Slugs with no pointer are remembered apart, in an LRU of their own, so a
// stream of requests for made-up slugs never pushes a real site out.
export const MAX_ABSENT_SITES = 1_000;
// A load holds the text and the parsed pointer at once, before the cache
// evicts anything: charged 4 bytes per byte of the object, from its size and
// before its body is read. Loads of different sites run in parallel; past
// this many bytes between them a load is refused (a 503 the client retries,
// or the stale copy, see MAX_STALE_MS) rather than risk the isolate. A single
// pointer of the largest size fits twice over.
export const loadingHeapOf = (size: number) => size * 4;
export const MAX_LOADING_HEAP = 24 * 1024 * 1024;
// One owner's loads share at most half of that (one of the largest size), so
// loads for one account's sites leave room for everyone else's. The owner of a
// slug is known once its pointer has been read in this isolate (a site read
// for the first time is charged to the whole budget only).
export const MAX_OWNER_LOADING_HEAP = MAX_LOADING_HEAP / 2;
// How many slugs' owners are remembered, cached or not, for that charge.
const MAX_KNOWN_OWNERS = 10_000;

export class MalformedPointerError extends Error {}
// The loads in flight hold as much memory as they may: try again shortly.
export class PointerBusyError extends Error {}

// Adds `amount` (negative to take away) to `key`'s tally, dropping it at 0.
const tally = (totals: Map<string, number>, key: string, amount: number) => {
  const total = (totals.get(key) ?? 0) + amount;
  if (total > 0) totals.set(key, total);
  else totals.delete(key);
};

// Makes `key` the most recently used of an LRU map (a Map iterates in
// insertion order), and drops its oldest keys past `max`.
const touch = <V>(map: Map<string, V>, key: string, value: V, max: number) => {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= max) break;
    map.delete(oldest);
  }
};

// A per-isolate cache of pointers, keyed by slug. At most one R2 read per slug
// is in flight: requests that arrive while one is revalidating wait for it.
export const createPointerCache = (now: () => number = Date.now) => {
  const cache = new Map<string, Cached>();
  // Slugs with no pointer, by when R2 said so.
  const absent = new Map<string, number>();
  const owners = new Map<string, string>();
  const inflight = new Map<string, Promise<LoadedPointer>>();
  let cachedHeap = 0;
  const ownerHeap = new Map<string, number>();
  let loadingHeap = 0;
  const ownerLoading = new Map<string, number>();

  const drop = (slug: string) => {
    const entry = cache.get(slug);
    if (!entry) return;
    cache.delete(slug);
    cachedHeap -= entry.heap;
    tally(ownerHeap, entry.pointer.u, -entry.heap);
  };

  const store = (slug: string, entry: Cached) => {
    drop(slug);
    absent.delete(slug);
    cache.set(slug, entry);
    cachedHeap += entry.heap;
    const owner = entry.pointer.u;
    tally(ownerHeap, owner, entry.heap);
    touch(owners, slug, owner, MAX_KNOWN_OWNERS);
    // Oldest first: a Map iterates in insertion order, and a hit re-inserts.
    // The owner's own sites first, down to its share; then anyone's.
    for (const [key, old] of cache) {
      if ((ownerHeap.get(owner) ?? 0) <= MAX_OWNER_CACHED_HEAP) break;
      if (key !== slug && old.pointer.u === owner) drop(key);
    }
    for (const key of cache.keys()) {
      if (cachedHeap <= MAX_CACHED_HEAP && cache.size <= MAX_CACHED_SITES) break;
      if (key !== slug) drop(key);
    }
  };

  const storeAbsent = (slug: string) => {
    drop(slug);
    touch(absent, slug, now(), MAX_ABSENT_SITES);
  };

  // Reads and parses a pointer's body, within the loading budget, and within
  // its owner's share of it when the owner is known.
  const read = async (slug: string, object: R2ObjectBody) => {
    const discard = () => object.body.cancel().catch(() => {});
    if (object.size > MAX_POINTER_BYTES) {
      await discard();
      throw new MalformedPointerError(`pointer of ${slug} is ${object.size} bytes`);
    }
    const reserved = loadingHeapOf(object.size);
    const owner = owners.get(slug);
    if (
      loadingHeap + reserved > MAX_LOADING_HEAP ||
      (owner !== undefined && (ownerLoading.get(owner) ?? 0) + reserved > MAX_OWNER_LOADING_HEAP)
    ) {
      await discard();
      throw new PointerBusyError(`pointer loads are at their memory budget (${slug})`);
    }
    loadingHeap += reserved;
    if (owner !== undefined) tally(ownerLoading, owner, reserved);
    try {
      const text = await object.text();
      const pointer = parsePointer(text);
      if (!pointer) throw new MalformedPointerError(`pointer of ${slug} is malformed`);
      return { pointer, heap: cachedHeapOf(text) };
    } finally {
      loadingHeap -= reserved;
      if (owner !== undefined) tally(ownerLoading, owner, -reserved);
    }
  };

  const ask = async (bucket: R2Bucket, slug: string, cached: Cached | undefined) => {
    const object = await bucket.get(
      pointerKey(slug),
      cached ? { onlyIf: { etagDoesNotMatch: cached.etag } } : undefined,
    );
    if (object === null) {
      // No pointer: the site does not exist (or no longer does). Remembered
      // too, so a stream of requests for a missing site does not each read R2.
      storeAbsent(slug);
      return { pointer: null, written: null };
    }
    const checkedAt = now();
    let entry: Cached;
    if (!("body" in object)) {
      // Unchanged since the cached copy.
      entry = { ...cached!, checkedAt, confirmedAt: checkedAt };
    } else {
      const { pointer, heap } = await read(slug, object);
      entry = { pointer, written: object.uploaded, etag: object.etag, checkedAt, confirmedAt: checkedAt, heap };
    }
    store(slug, entry);
    return entry;
  };

  const refresh = async (
    bucket: R2Bucket,
    slug: string,
    cached: Cached | undefined,
  ): Promise<LoadedPointer> => {
    try {
      return await ask(bucket, slug, cached);
    } catch (e) {
      // The cached copy, while R2 answered for it recently enough; asked
      // again a revalidation window from now.
      if (!cached || now() - cached.confirmedAt >= MAX_STALE_MS) throw e;
      console.warn(`serving the cached pointer of ${slug}:`, e);
      const entry = { ...cached, checkedAt: now() };
      if (cache.get(slug) === cached) store(slug, entry);
      return entry;
    }
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
    const absentAt = absent.get(slug);
    if (absentAt !== undefined && now() - absentAt < maxAgeMs) {
      touch(absent, slug, absentAt, MAX_ABSENT_SITES);
      return { pointer: null, written: null };
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
    // Sites cached with a pointer, and slugs remembered as having none.
    size: () => cache.size,
    absent: () => absent.size,
    cachedHeap: () => cachedHeap,
    ownerHeap: (owner: string) => ownerHeap.get(owner) ?? 0,
    loadingHeap: () => loadingHeap,
  };
};

export type PointerCache = ReturnType<typeof createPointerCache>;

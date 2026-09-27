import { utf8Bytes } from "../lib/paths";
import { KEEP_VERSIONS, MAX_POINTER_BYTES } from "../lib/publish-limits";
import { pointerKey, type ObjectStore } from "../lib/storage";
import type { PublishStore, SiteRow, VersionSiteFileRow } from "./publish.store";

// A site's live pointer, m/<slug>.json in the SITES bucket: the manifest the
// publish Worker (packages/publish-worker, src/pointer.ts) serves the site
// from. Each file names its content by sha256, stored at c/<owner>/<sha256>:
//
//   { "v": 1, "version": 7, "u": "<owner id>",
//     "files": { "index.html": { "h": "<sha256>", "s": 1234, "t": "text/html; charset=utf-8" },
//                "assets/index-AbC12345.js": { "h": "…", "s": 99, "t": "…", "i": 1 } } }
//
// "i": 1 marks an immutable file (version_site_file.immutable: the build named
// it by its content), which the Worker caches for a year. The pointer lists
// every file of the head version, plus "grace" entries: the immutable files of
// the previous KEEP_VERSIONS - 1 versions that the head does not define, so a
// tab still open on an older version can lazy-load its chunks. A file the
// build did not name by content (a public file, even one whose name looks
// hashed) is never a grace entry, so removing it takes it off the site. Those versions are the ones retention
// keeps, so their contents are still referenced. A publish switches the site
// over by writing the whole pointer in one put, after its commit, and only
// forward: an older version never replaces a newer pointer.

type PointerEntry = { h: string; s: number; t: string; i?: 1 };

export type BuiltPointer = { json: string; graceEntries: number; droppedGrace: number };

const entryOf = (f: VersionSiteFileRow): PointerEntry =>
  f.immutable
    ? { h: f.sha256, s: f.size, t: f.contentType, i: 1 }
    : { h: f.sha256, s: f.size, t: f.contentType };

// The pointer for `site` at `head`, from its versions' site files (newest
// first, as pointerFiles returns them). Null when the head has no files (its
// version is gone). Grace entries are added newest version first until the
// pointer would pass `maxBytes`; the rest, the oldest, are dropped. The head's
// own entries always fit: MAX_PLAN_JSON_BYTES bounds a plan, which says more
// about each file than the pointer does.
export const buildPointer = (
  site: Pick<SiteRow, "userId">,
  head: number,
  rows: VersionSiteFileRow[],
  maxBytes = MAX_POINTER_BYTES,
): BuiltPointer | null => {
  // A Map, then Object.fromEntries: a path such as "__proto__" stays an own
  // property (the Worker looks entries up with Object.hasOwn).
  const files = new Map<string, PointerEntry>();
  for (const f of rows) if (f.version === head) files.set(f.path, entryOf(f));
  if (files.size === 0) return null;

  const envelope = (entries: Map<string, PointerEntry>) =>
    JSON.stringify({ v: 1, version: head, u: site.userId, files: Object.fromEntries(entries) });
  let bytes = utf8Bytes(envelope(files));
  let graceEntries = 0;
  let droppedGrace = 0;
  const oldest = head - (KEEP_VERSIONS - 1);
  const grace = rows
    .filter((f) => f.version < head && f.version >= oldest && f.immutable)
    .sort((a, b) => b.version - a.version);
  for (const f of grace) {
    if (files.has(f.path)) continue; // the head's, or a newer version's
    // `,"<path>":{…}`
    const size = utf8Bytes(JSON.stringify(f.path)) + utf8Bytes(JSON.stringify(entryOf(f))) + 2;
    if (droppedGrace > 0 || bytes + size > maxBytes) {
      droppedGrace++;
      continue;
    }
    files.set(f.path, entryOf(f));
    bytes += size;
    graceEntries++;
  }
  return { json: envelope(files), graceEntries, droppedGrace };
};

type PointerDeps = { store: PublishStore; sites: ObjectStore };

// "written": this call put the head's pointer. "current": the pointer was
// already at the head or past it. "gone": the head version has no files to
// point at (pruned meanwhile; a later sync has a newer head). "raced": the
// pointer changed under both attempts; the caller retries later.
export type SyncOutcome = "written" | "current" | "gone" | "raced";

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

// The version the pointer object names; -1 when it is not a pointer.
const pointerVersionOf = async (body: ReadableStream): Promise<number> => {
  try {
    const parsed = JSON.parse(await new Response(body).text()) as { version?: unknown };
    return Number.isSafeInteger(parsed.version) ? (parsed.version as number) : -1;
  } catch {
    return -1;
  }
};

// Writes the site's head pointer unless the pointer is already there or newer:
// read it, skip when its version is >= the head, else put against the etag
// read (or against there being none), and on a precondition failure read and
// try once more. Records the outcome in site.pointer_version. Throws on a
// storage failure.
export const syncPointer = async (deps: PointerDeps, site: SiteRow): Promise<SyncOutcome> => {
  const head = site.headVersion;
  if (head === 0) return "current";
  const rows = await deps.store.pointerFiles(site.id, head, head - (KEEP_VERSIONS - 1));
  const built = buildPointer(site, head, rows);
  if (!built) {
    console.warn("publish: no site files for the head version", site.id, head);
    return "gone";
  }
  if (built.droppedGrace > 0) {
    console.warn("publish: pointer grace entries dropped for size", {
      siteId: site.id,
      version: head,
      kept: built.graceEntries,
      dropped: built.droppedGrace,
    });
  }
  const bytes = encoder.encode(built.json);
  const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));
  const key = pointerKey(site.slug);

  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await deps.sites.get(key);
    if (current) {
      const version = await pointerVersionOf(current.body);
      if (version >= head) {
        await deps.store.setPointerVersion(site.id, version);
        return "current";
      }
    }
    const written = await deps.sites.put(key, bytes, {
      size: bytes.length,
      sha256,
      contentType: "application/json",
      onlyIf: current ? { etagMatches: current.etag } : { absent: true },
    });
    if (written) {
      await deps.store.setPointerVersion(site.id, head);
      return "written";
    }
  }
  return "raced";
};

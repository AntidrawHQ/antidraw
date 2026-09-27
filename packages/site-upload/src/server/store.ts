import { SiteUploadError } from "../protocol/errors";
import { resolveLimits, STORED_LIMITS, type Limits } from "../protocol/limits";
import {
  hashSizes,
  isHash,
  isId,
  parseManifest,
  sameFiles,
  type CommitResult,
  type Files,
  type PlanResult,
} from "../protocol/manifest";
import {
  deleteAll,
  hasBody,
  listAll,
  type Bucket,
  type BucketObject,
  type BucketObjectBody,
  type BucketRange,
} from "./bucket";

/** What a site serves: the committed files plus where it came from. */
export type Pointer = {
  v: 1;
  publishId: string;
  previous: string | null;
  committedAt: number;
  files: Files;
  /**
   * Immutable files of the version before this one that this one dropped.
   * Pages opened on that version keep loading their hashed chunks.
   */
  retained: Files;
};

type StoredPlan = { v: 1; publishId: string; createdAt: number; files: Files };

export type CleanupResult = { deletedFiles: number; deletedPlans: number };

export type SiteStoreOptions = {
  bucket: Bucket;
  /** Key prefix for every site. Default "sites". */
  prefix?: string;
  limits?: Partial<Limits>;
  /** How long a plan can be uploaded to and committed. Default 1 hour. */
  planTtlMs?: number;
  /** Unreferenced files younger than this are never deleted. Default 1 hour. */
  orphanGraceMs?: number;
  now?: () => number;
};

const HOUR = 60 * 60 * 1000;
// The upload plan cache holds hash → size maps, capped by their total size so
// a few very large plans can't exhaust the isolate's memory.
const PLAN_CACHE_MAX_HASHES = 50_000;

type CachedPlan = { createdAt: number; sizes: Map<string, number> };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const internal = (message: string) => new SiteUploadError("INTERNAL", message);

/**
 * Content-addressed site storage on R2:
 *
 *   <prefix>/<site>/f/<sha256>        file bytes, shared by every version of the site
 *   <prefix>/<site>/m/<publishId>.json the manifest of one publish (its plan)
 *   <prefix>/<site>/current.json      the pointer: the live manifest, swapped in one write
 *
 * Contract: calls for one site must not overlap with its cleanup(). The caller
 * serializes them (a per-site lock). Plan expiry and the orphan grace period
 * keep a crashed lock holder from causing damage, but they don't replace it.
 *
 * Create one SiteStore per isolate (at module scope), not per request, so its
 * plan cache is reused across a publish's uploads.
 */
export class SiteStore {
  readonly bucket: Bucket;
  readonly limits: Limits;
  private readonly prefix: string;
  private readonly planTtlMs: number;
  private readonly orphanGraceMs: number;
  private readonly now: () => number;
  private readonly planCache = new Map<string, CachedPlan>();
  private cachedHashes = 0;

  constructor(options: SiteStoreOptions) {
    const prefix = options.prefix ?? "sites";
    if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(prefix)) {
      throw new TypeError(`Invalid key prefix: ${prefix}`);
    }
    this.bucket = options.bucket;
    this.prefix = prefix;
    this.limits = resolveLimits(options.limits);
    this.planTtlMs = options.planTtlMs ?? HOUR;
    this.orphanGraceMs = options.orphanGraceMs ?? HOUR;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records the manifest for `publishId` and returns the hashes the site
   * doesn't have yet. Safe to repeat with the same manifest.
   */
  async plan(site: string, publishId: string, input: unknown): Promise<PlanResult> {
    this.assertIds(site, publishId);
    const { files } = parseManifest(input, this.limits);

    const current = await this.readPointer(site);
    if (current?.publishId === publishId) {
      if (!sameFiles(current.files, files)) throw planExists(publishId);
      return { missing: [] };
    }

    const existing = await this.readPlan(site, publishId);
    if (existing) {
      if (!sameFiles(existing.files, files)) throw planExists(publishId);
      if (this.isExpired(existing)) throw planExpired(publishId);
    } else {
      const plan: StoredPlan = { v: 1, publishId, createdAt: this.now(), files };
      await this.bucket.put(this.planKey(site, publishId), JSON.stringify(plan), {
        httpMetadata: { contentType: "application/json" },
        // Lets cleanup see a plan's age from a listing, without reading it.
        customMetadata: { createdAt: String(plan.createdAt) },
      });
    }

    const stored = await this.storedSizes(site);
    const missing: string[] = [];
    for (const [hash, size] of hashSizes(files)) {
      if (stored.get(hash) !== size) missing.push(hash);
    }
    return { missing: missing.sort() };
  }

  /**
   * Stores one file of a plan. R2 checks the bytes against `hash` and rejects
   * the write if they differ, so a stored file always matches its key.
   */
  async putFile(
    site: string,
    publishId: string,
    hash: string,
    body: ReadableStream | ArrayBuffer | ArrayBufferView | null,
    contentLength: number | null,
  ): Promise<void> {
    this.assertIds(site, publishId);
    if (!isHash(hash)) {
      throw new SiteUploadError("INVALID_REQUEST", "The file hash must be a lowercase sha256 hex digest");
    }
    const { sizes } = await this.uploadPlan(site, publishId);
    const size = sizes.get(hash);
    if (size === undefined) {
      throw new SiteUploadError("NOT_IN_PLAN", `${hash} is not part of publish ${publishId}`, { hash });
    }
    if (contentLength === null) {
      throw new SiteUploadError("LENGTH_REQUIRED", "A Content-Length header is required");
    }
    if (contentLength !== size) {
      throw new SiteUploadError(
        "SIZE_MISMATCH",
        `${hash} is ${size} bytes in the plan but ${contentLength} bytes were sent`,
        { hash, expected: size, actual: contentLength },
      );
    }

    let value = body;
    // In Workers this makes the length known to R2 and fails the write if the
    // client sends more or fewer bytes than it declared.
    const FixedLengthStream = (globalThis as { FixedLengthStream?: new (length: number) => TransformStream })
      .FixedLengthStream;
    if (value instanceof ReadableStream && FixedLengthStream) {
      value = value.pipeThrough(new FixedLengthStream(size));
    }

    let written;
    try {
      written = await this.bucket.put(this.fileKey(site, hash), value ?? new Uint8Array(0), {
        sha256: hash,
      });
    } catch (err) {
      if (isChecksumError(err)) {
        throw new SiteUploadError("HASH_MISMATCH", `The bytes sent don't hash to ${hash}`, { hash });
      }
      throw err;
    }
    if (!written || written.size !== size) {
      throw new SiteUploadError(
        "SIZE_MISMATCH",
        `${hash} was stored with ${written?.size ?? 0} bytes, expected ${size}`,
        { hash, expected: size, actual: written?.size ?? 0 },
      );
    }
  }

  /**
   * Makes `publishId` the live version once every file is stored. The pointer
   * is one object, so viewers see the old version or the new one, never a mix.
   *
   * Repeating a commit is safe while it is still the latest: it returns
   * `alreadyCommitted: true`. Once a newer publish has gone live, a replayed
   * commit gets SUPERSEDED instead of rolling the site back.
   */
  async commit(site: string, publishId: string): Promise<CommitResult> {
    this.assertIds(site, publishId);
    const currentObject = await this.bucket.get(this.pointerKey(site));
    const current = currentObject && hasBody(currentObject) ? parsePointer(await currentObject.text()) : null;
    if (current?.publishId === publishId) {
      return { publishId, previous: current.previous, alreadyCommitted: true };
    }

    const plan = await this.readPlan(site, publishId);
    if (!plan) throw noPlan(publishId);
    if (this.isExpired(plan)) throw planExpired(publishId);
    // The per-site lock means each publish plans after the previous one
    // committed, so a plan older than the live commit is a stale retry, e.g.
    // one whose first commit went through but whose reply was lost.
    if (current && plan.createdAt < current.committedAt) {
      throw new SiteUploadError(
        "SUPERSEDED",
        `Publish ${current.publishId} went live after ${publishId} was planned`,
        { live: current.publishId },
      );
    }

    const stored = await this.storedSizes(site);
    const missing: string[] = [];
    for (const [hash, size] of hashSizes(plan.files)) {
      if (stored.get(hash) !== size) missing.push(hash);
    }
    if (missing.length > 0) {
      throw new SiteUploadError(
        "MISSING_FILES",
        `${missing.length} file${missing.length === 1 ? " is" : "s are"} not uploaded yet`,
        { missing: missing.sort() },
      );
    }

    const previous = current?.publishId ?? null;
    const retained: Files = Object.create(null);
    if (current) {
      for (const path in current.files) {
        const entry = current.files[path]!;
        if (entry.i && !(path in plan.files)) retained[path] = entry;
      }
    }
    const pointer: Pointer = {
      v: 1,
      publishId,
      previous,
      committedAt: this.now(),
      files: plan.files,
      retained,
    };
    const written = await this.bucket.put(this.pointerKey(site), JSON.stringify(pointer), {
      httpMetadata: { contentType: "application/json" },
      ...(currentObject ? { onlyIf: { etagMatches: currentObject.etag } } : {}),
    });
    if (written === null) {
      // Lost the race; if the winner was this same publish (a retry racing
      // its own first attempt), the commit did happen.
      const winner = await this.readPointer(site);
      if (winner?.publishId === publishId) {
        return { publishId, previous: winner.previous, alreadyCommitted: true };
      }
      throw new SiteUploadError("CONFLICT", "Another publish of this site committed first");
    }
    this.forgetPlan(this.planKey(site, publishId));
    return { publishId, previous, alreadyCommitted: false };
  }

  /**
   * Deletes files nothing can serve or commit any more: everything outside
   * the live version, its retained files, and plans still inside their upload
   * window. Expired plans are deleted too. Any failed read aborts the cleanup
   * rather than risk deleting a needed file; the next run tries again.
   */
  async cleanup(site: string): Promise<CleanupResult> {
    if (!isId(site)) throw invalidId("site");
    const now = this.now();
    const current = await this.readPointer(site);
    const keep = new Set<string>();
    if (current) {
      for (const hash of hashSizes(current.files).keys()) keep.add(hash);
      for (const hash of hashSizes(current.retained).keys()) keep.add(hash);
    }

    // Expired plans are deleted without being read: a plan's age comes from
    // the createdAt it was written with, returned by the listing itself, on
    // the same clock plan() and commit() use.
    const planPrefix = `${this.siteRoot(site)}m/`;
    const stalePlans: string[] = [];
    for await (const object of listAll(this.bucket, planPrefix, ["customMetadata"])) {
      const id = object.key.slice(planPrefix.length).replace(/\.json$/, "");
      if (id === current?.publishId) continue;
      if (planCreatedAt(object) + this.planTtlMs <= now) {
        stalePlans.push(object.key);
        continue;
      }
      const plan = await this.readPlan(site, id);
      if (plan) for (const hash of hashSizes(plan.files).keys()) keep.add(hash);
    }

    const filePrefix = `${this.siteRoot(site)}f/`;
    const staleFiles: string[] = [];
    for await (const object of listAll(this.bucket, filePrefix)) {
      if (keep.has(object.key.slice(filePrefix.length))) continue;
      if (object.uploaded.getTime() + this.orphanGraceMs <= now) staleFiles.push(object.key);
    }

    await deleteAll(this.bucket, [...staleFiles, ...stalePlans]);
    for (const key of stalePlans) this.forgetPlan(key);
    return { deletedFiles: staleFiles.length, deletedPlans: stalePlans.length };
  }

  /** Deletes everything stored for a site. */
  async deleteSite(site: string): Promise<number> {
    if (!isId(site)) throw invalidId("site");
    const keys: string[] = [];
    for await (const object of listAll(this.bucket, this.siteRoot(site))) keys.push(object.key);
    await deleteAll(this.bucket, keys);
    this.planCache.clear();
    this.cachedHashes = 0;
    return keys.length;
  }

  async readPointer(site: string): Promise<Pointer | null> {
    return (await this.readPointerSized(site)).pointer;
  }

  /** The pointer and its stored size, which SiteServer uses to bound its cache. */
  async readPointerSized(site: string): Promise<{ pointer: Pointer | null; bytes: number }> {
    if (!isId(site)) throw invalidId("site");
    const object = await this.bucket.get(this.pointerKey(site));
    if (!object || !hasBody(object)) return { pointer: null, bytes: 0 };
    return { pointer: parsePointer(await object.text()), bytes: object.size };
  }

  async getFile(site: string, hash: string, range?: BucketRange): Promise<BucketObjectBody | null> {
    const object = await this.bucket.get(this.fileKey(site, hash), range ? { range } : undefined);
    return hasBody(object) ? object : null;
  }

  private async uploadPlan(site: string, publishId: string): Promise<CachedPlan> {
    const key = this.planKey(site, publishId);
    let cached = this.planCache.get(key);
    if (!cached) {
      const plan = await this.readPlan(site, publishId);
      if (!plan) throw noPlan(publishId);
      cached = { createdAt: plan.createdAt, sizes: hashSizes(plan.files) };
      this.planCache.set(key, cached);
      this.cachedHashes += cached.sizes.size;
      while (this.cachedHashes > PLAN_CACHE_MAX_HASHES && this.planCache.size > 1) {
        this.forgetPlan(this.planCache.keys().next().value!);
      }
    }
    if (cached.createdAt + this.planTtlMs <= this.now()) throw planExpired(publishId);
    return cached;
  }

  private forgetPlan(key: string) {
    const cached = this.planCache.get(key);
    if (!cached) return;
    this.planCache.delete(key);
    this.cachedHashes -= cached.sizes.size;
  }

  private async readPlan(site: string, publishId: string): Promise<StoredPlan | null> {
    const object = await this.bucket.get(this.planKey(site, publishId));
    if (!object || !hasBody(object)) return null;
    return parsePlan(await object.text());
  }

  private async storedSizes(site: string): Promise<Map<string, number>> {
    const prefix = `${this.siteRoot(site)}f/`;
    const sizes = new Map<string, number>();
    for await (const object of listAll(this.bucket, prefix)) {
      sizes.set(object.key.slice(prefix.length), object.size);
    }
    return sizes;
  }

  private isExpired(plan: StoredPlan, now = this.now()) {
    return plan.createdAt + this.planTtlMs <= now;
  }

  private assertIds(site: string, publishId: string) {
    if (!isId(site)) throw invalidId("site");
    if (!isId(publishId)) throw invalidId("publishId");
  }

  private siteRoot = (site: string) => `${this.prefix}/${site}/`;
  private pointerKey = (site: string) => `${this.siteRoot(site)}current.json`;
  private planKey = (site: string, publishId: string) => `${this.siteRoot(site)}m/${publishId}.json`;
  private fileKey = (site: string, hash: string) => `${this.siteRoot(site)}f/${hash}`;
}

// A plan listed without its createdAt (not written by this store) falls back
// to R2's upload time, which is when it was written.
function planCreatedAt(object: BucketObject): number {
  const createdAt = Number(object.customMetadata?.createdAt);
  return Number.isSafeInteger(createdAt) ? createdAt : object.uploaded.getTime();
}

function parsePointer(text: string): Pointer {
  const value = parseJson(text, "pointer");
  if (
    value.v !== 1 ||
    !isId(value.publishId) ||
    !(value.previous === null || isId(value.previous)) ||
    typeof value.committedAt !== "number"
  ) {
    throw internal("The site pointer is malformed");
  }
  return {
    v: 1,
    publishId: value.publishId,
    previous: value.previous,
    committedAt: value.committedAt,
    files: parseStoredFiles(value.files, "pointer"),
    retained:
      isObject(value.retained) && Object.keys(value.retained).length > 0
        ? parseStoredFiles(value.retained, "pointer")
        : Object.create(null),
  };
}

function parsePlan(text: string): StoredPlan {
  const value = parseJson(text, "plan");
  if (value.v !== 1 || !isId(value.publishId) || typeof value.createdAt !== "number") {
    throw internal("A stored plan is malformed");
  }
  return {
    v: 1,
    publishId: value.publishId,
    createdAt: value.createdAt,
    files: parseStoredFiles(value.files, "plan"),
  };
}

function parseJson(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw internal(`The stored ${what} is not valid JSON`);
  }
  if (!isObject(value)) throw internal(`The stored ${what} is malformed`);
  return value;
}

function parseStoredFiles(files: unknown, what: string): Files {
  try {
    return parseManifest({ v: 1, files }, STORED_LIMITS).files;
  } catch {
    throw internal(`The stored ${what} has an invalid file list`);
  }
}

// R2 rejects a put whose body doesn't match the sha256 option (error 10037,
// "BadDigest"). The error has no code property, so match on the message.
function isChecksumError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /sha-?256|checksum|digest|10037/i.test(message);
}

const invalidId = (what: string) =>
  new SiteUploadError("INVALID_REQUEST", `Invalid ${what}: use 1-128 letters, digits, _ or -`);
const noPlan = (publishId: string) =>
  new SiteUploadError("NO_PLAN", `No plan was recorded for publish ${publishId}`);
const planExpired = (publishId: string) =>
  new SiteUploadError("PLAN_EXPIRED", `Publish ${publishId} took too long; start a new one`);
const planExists = (publishId: string) =>
  new SiteUploadError("PLAN_EXISTS", `Publish ${publishId} already has a different file list`);

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
import { deleteAll, hasBody, listAll, type Bucket, type BucketObjectBody, type BucketRange } from "./bucket";

/** What a site serves: the committed files plus where it came from. */
export type Pointer = {
  v: 1;
  publishId: string;
  previous: string | null;
  committedAt: number;
  files: Files;
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
const PLAN_CACHE_SIZE = 32;

type CachedPlan = { plan: StoredPlan; sizes: Map<string, number> };

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
 */
export class SiteStore {
  readonly bucket: Bucket;
  readonly limits: Limits;
  private readonly prefix: string;
  private readonly planTtlMs: number;
  private readonly orphanGraceMs: number;
  private readonly now: () => number;
  private readonly planCache = new Map<string, CachedPlan>();

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
   * Repeating a commit that already went through returns the same result.
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
    const pointer: Pointer = { v: 1, publishId, previous, committedAt: this.now(), files: plan.files };
    const written = await this.bucket.put(this.pointerKey(site), JSON.stringify(pointer), {
      httpMetadata: { contentType: "application/json" },
      ...(currentObject ? { onlyIf: { etagMatches: currentObject.etag } } : {}),
    });
    if (written === null) {
      throw new SiteUploadError("CONFLICT", "Another publish of this site committed first");
    }
    this.planCache.delete(this.planKey(site, publishId));
    return { publishId, previous, alreadyCommitted: false };
  }

  /**
   * Deletes files no version needs: anything outside the live version, the
   * one before it (pages still open in browsers load its files), and plans
   * still inside their upload window. Expired plans are deleted too.
   */
  async cleanup(site: string): Promise<CleanupResult> {
    if (!isId(site)) throw invalidId("site");
    const now = this.now();
    const current = await this.readPointer(site);
    const keepPlans = new Set<string>();
    const keep = new Set<string>();
    if (current) {
      keepPlans.add(current.publishId);
      for (const hash of hashSizes(current.files).keys()) keep.add(hash);
      if (current.previous) {
        keepPlans.add(current.previous);
        const previous = await this.readPlan(site, current.previous).catch(() => null);
        if (previous) for (const hash of hashSizes(previous.files).keys()) keep.add(hash);
      }
    }

    const planPrefix = `${this.siteRoot(site)}m/`;
    const stalePlans: string[] = [];
    for await (const object of listAll(this.bucket, planPrefix)) {
      const id = object.key.slice(planPrefix.length).replace(/\.json$/, "");
      if (keepPlans.has(id)) continue;
      const plan = await this.readPlan(site, id).catch(() => null);
      if (plan && !this.isExpired(plan, now)) {
        for (const hash of hashSizes(plan.files).keys()) keep.add(hash);
      } else {
        stalePlans.push(object.key);
      }
    }

    const filePrefix = `${this.siteRoot(site)}f/`;
    const staleFiles: string[] = [];
    for await (const object of listAll(this.bucket, filePrefix)) {
      if (keep.has(object.key.slice(filePrefix.length))) continue;
      if (object.uploaded.getTime() + this.orphanGraceMs <= now) staleFiles.push(object.key);
    }

    await deleteAll(this.bucket, [...staleFiles, ...stalePlans]);
    for (const key of stalePlans) this.planCache.delete(key);
    return { deletedFiles: staleFiles.length, deletedPlans: stalePlans.length };
  }

  /** Deletes everything stored for a site. */
  async deleteSite(site: string): Promise<number> {
    if (!isId(site)) throw invalidId("site");
    const keys: string[] = [];
    for await (const object of listAll(this.bucket, this.siteRoot(site))) keys.push(object.key);
    await deleteAll(this.bucket, keys);
    this.planCache.clear();
    return keys.length;
  }

  async readPointer(site: string): Promise<Pointer | null> {
    if (!isId(site)) throw invalidId("site");
    const object = await this.bucket.get(this.pointerKey(site));
    return object && hasBody(object) ? parsePointer(await object.text()) : null;
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
      cached = { plan, sizes: hashSizes(plan.files) };
      this.planCache.set(key, cached);
      if (this.planCache.size > PLAN_CACHE_SIZE) {
        this.planCache.delete(this.planCache.keys().next().value!);
      }
    }
    if (this.isExpired(cached.plan)) throw planExpired(publishId);
    return cached;
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

import { SiteUploadError } from "../protocol/errors";
import { resolveLimits, STORED_LIMITS, type Limits } from "../protocol/limits";
import { hashSizes, isHash, isId, parseManifest, sameFiles, type Files, type PlanResult } from "../protocol/manifest";
import {
  deleteAll,
  hasBody,
  listAll,
  type Bucket,
  type BucketObject,
  type BucketObjectBody,
  type BucketRange,
} from "./bucket";

/** One publish's manifest, written once when it plans and never changed. */
type StoredPlan = { v: 1; publishId: string; createdAt: number; files: Files };

/** A publish's files, and the stored size of its manifest (SiteServer bounds its cache by it). */
export type StoredManifest = { files: Files; bytes: number };

export type CleanupResult = { deletedFiles: number; deletedPlans: number };

export type SiteStoreOptions = {
  bucket: Bucket;
  /** Key prefix for every site. Default "sites". */
  prefix?: string;
  limits?: Partial<Limits>;
  /** cleanup() never deletes a plan or file younger than this. Default 1 hour. */
  graceMs?: number;
  now?: () => number;
};

const HOUR = 60 * 60 * 1000;
// The upload plan cache holds hash → size maps, capped by their total size so
// a few very large plans can't exhaust the isolate's memory.
const PLAN_CACHE_MAX_HASHES = 50_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const internal = (message: string) => new SiteUploadError("INTERNAL", message);

/**
 * Content-addressed site storage on R2. Nothing here changes once written:
 *
 *   <prefix>/<site>/f/<sha256>          file bytes, shared by every version of the site
 *   <prefix>/<site>/m/<publishId>.json  one publish's manifest, written when it plans
 *
 * A published version is one of those manifests. Which one is live is the
 * caller's to record (a database row): commit by checking the plan is
 * complete (requireComplete), then switching the caller's record to it, only
 * if it still names the version this publish started from. Serving asks the
 * caller the same thing (SiteServer's `current`).
 *
 * Publishes of one site may overlap freely. Nothing is deleted while
 * publishing; cleanup() is the only delete, and must not overlap any other call
 * for the site (a plan made during it can be told a file is stored that it
 * then deletes).
 *
 * Create one SiteStore per isolate (at module scope), not per request, so its
 * plan cache is reused across a publish's uploads.
 */
export class SiteStore {
  readonly bucket: Bucket;
  readonly limits: Limits;
  private readonly prefix: string;
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly planCache = new Map<string, Map<string, number>>();
  private cachedHashes = 0;

  constructor(options: SiteStoreOptions) {
    const prefix = options.prefix ?? "sites";
    if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(prefix)) {
      throw new TypeError(`Invalid key prefix: ${prefix}`);
    }
    this.bucket = options.bucket;
    this.prefix = prefix;
    this.limits = resolveLimits(options.limits);
    this.graceMs = options.graceMs ?? HOUR;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records the manifest for `publishId` and returns the hashes the site
   * doesn't have yet. Safe to repeat with the same manifest; a different one
   * for the same publish is refused.
   */
  async plan(site: string, publishId: string, input: unknown): Promise<PlanResult> {
    this.assertIds(site, publishId);
    const { files } = parseManifest(input, this.limits);

    const existing = await this.readPlan(site, publishId);
    if (existing) {
      if (!sameFiles(existing.files, files)) throw planExists(publishId);
    } else {
      const plan: StoredPlan = { v: 1, publishId, createdAt: this.now(), files };
      await this.bucket.put(this.planKey(site, publishId), JSON.stringify(plan), {
        httpMetadata: { contentType: "application/json" },
        // Lets cleanup see a plan's age from a listing, without reading it.
        customMetadata: { createdAt: String(plan.createdAt) },
      });
    }
    return { missing: await this.missing(site, files) };
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
    const sizes = await this.uploadPlan(site, publishId);
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
   * Checks `publishId` can go live: it planned, and every file of its plan is
   * stored. The caller then records it as live. Nothing is deleted while
   * publishing, so the files stay.
   */
  async requireComplete(site: string, publishId: string): Promise<void> {
    this.assertIds(site, publishId);
    const plan = await this.readPlan(site, publishId);
    if (!plan) throw noPlan(publishId);
    const missing = await this.missing(site, plan.files);
    if (missing.length > 0) {
      throw new SiteUploadError(
        "MISSING_FILES",
        `${missing.length} file${missing.length === 1 ? " is" : "s are"} not uploaded yet`,
        { missing },
      );
    }
  }

  /** A publish's manifest, as served. Null if it never planned (or was cleaned up). */
  async readManifest(site: string, publishId: string): Promise<StoredManifest | null> {
    this.assertIds(site, publishId);
    const object = await this.bucket.get(this.planKey(site, publishId));
    if (!object || !hasBody(object)) return null;
    return { files: parsePlan(await object.text()).files, bytes: object.size };
  }

  async getFile(site: string, hash: string, range?: BucketRange): Promise<BucketObjectBody | null> {
    const object = await this.bucket.get(this.fileKey(site, hash), range ? { range } : undefined);
    return hasBody(object) ? object : null;
  }

  /**
   * Deletes the plans of every publish not in `keep` (pass the live and
   * previous ones, and any you may roll back to), and the files only they
   * needed. Plans and files younger than the grace period are kept, in case a
   * publish is under way. Any failed read aborts it rather than risk deleting
   * a needed file.
   *
   * Must not overlap any other call for the site (see the class comment):
   * run it by hand when nothing is publishing.
   */
  async cleanup(site: string, { keep }: { keep: string[] }): Promise<CleanupResult> {
    if (!isId(site)) throw invalidId("site");
    const now = this.now();
    const kept = new Set(keep);
    const needed = new Set<string>();

    const planPrefix = `${this.siteRoot(site)}m/`;
    const stalePlans: string[] = [];
    for await (const object of listAll(this.bucket, planPrefix, ["customMetadata"])) {
      const id = object.key.slice(planPrefix.length).replace(/\.json$/, "");
      if (!kept.has(id) && planCreatedAt(object) + this.graceMs <= now) {
        stalePlans.push(object.key);
        continue;
      }
      const plan = await this.readPlan(site, id);
      if (plan) for (const hash of hashSizes(plan.files).keys()) needed.add(hash);
    }

    const filePrefix = `${this.siteRoot(site)}f/`;
    const staleFiles: string[] = [];
    for await (const object of listAll(this.bucket, filePrefix)) {
      if (needed.has(object.key.slice(filePrefix.length))) continue;
      if (object.uploaded.getTime() + this.graceMs <= now) staleFiles.push(object.key);
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

  /** The plan's hash → size map for uploads, cached: a publish sends many files. */
  private async uploadPlan(site: string, publishId: string): Promise<Map<string, number>> {
    const key = this.planKey(site, publishId);
    let sizes = this.planCache.get(key);
    if (!sizes) {
      const plan = await this.readPlan(site, publishId);
      if (!plan) throw noPlan(publishId);
      sizes = hashSizes(plan.files);
      this.planCache.set(key, sizes);
      this.cachedHashes += sizes.size;
      while (this.cachedHashes > PLAN_CACHE_MAX_HASHES && this.planCache.size > 1) {
        this.forgetPlan(this.planCache.keys().next().value!);
      }
    }
    return sizes;
  }

  private forgetPlan(key: string) {
    const sizes = this.planCache.get(key);
    if (!sizes) return;
    this.planCache.delete(key);
    this.cachedHashes -= sizes.size;
  }

  private async readPlan(site: string, publishId: string): Promise<StoredPlan | null> {
    const object = await this.bucket.get(this.planKey(site, publishId));
    if (!object || !hasBody(object)) return null;
    return parsePlan(await object.text());
  }

  /** The hashes of `files` the site doesn't have stored at the right size, sorted. */
  private async missing(site: string, files: Files): Promise<string[]> {
    const prefix = `${this.siteRoot(site)}f/`;
    const stored = new Map<string, number>();
    for await (const object of listAll(this.bucket, prefix)) {
      stored.set(object.key.slice(prefix.length), object.size);
    }
    const missing: string[] = [];
    for (const [hash, size] of hashSizes(files)) {
      if (stored.get(hash) !== size) missing.push(hash);
    }
    return missing.sort();
  }

  private assertIds(site: string, publishId: string) {
    if (!isId(site)) throw invalidId("site");
    if (!isId(publishId)) throw invalidId("publishId");
  }

  private siteRoot = (site: string) => `${this.prefix}/${site}/`;
  private planKey = (site: string, publishId: string) => `${this.siteRoot(site)}m/${publishId}.json`;
  private fileKey = (site: string, hash: string) => `${this.siteRoot(site)}f/${hash}`;
}

// A plan listed without its createdAt (not written by this store) falls back
// to R2's upload time, which is when it was written.
function planCreatedAt(object: BucketObject): number {
  const createdAt = Number(object.customMetadata?.createdAt);
  return Number.isSafeInteger(createdAt) ? createdAt : object.uploaded.getTime();
}

function parsePlan(text: string): StoredPlan {
  const value = parseJson(text, "plan");
  if (
    value.v !== 1 ||
    !isId(value.publishId) ||
    typeof value.createdAt !== "number"
  ) {
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
const planExists = (publishId: string) =>
  new SiteUploadError("PLAN_EXISTS", `Publish ${publishId} already has a different file list`);

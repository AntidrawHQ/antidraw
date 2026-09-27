import { err, ok, ResultAsync, type Result } from "neverthrow";
import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { apiError, type ApiError } from "../lib/errors";
import {
  caseKey,
  ENTRY_PATHS,
  isExcludedSnapshotPath,
  isImmutableSitePath,
  isPublishableSitePath,
  utf8Bytes,
} from "../lib/paths";
import {
  COMPLETE_LOCK_TTL_MS,
  KEEP_VERSIONS,
  MAX_ACCOUNT_ROW_BYTES,
  MAX_BEGIN_HEADS,
  MAX_OPEN_SESSIONS_PER_ACCOUNT,
  MAX_PENDING_SITE_BYTES,
  MAX_PLAN_JSON_BYTES,
  MAX_SITE_BYTES,
  MAX_SITES_PER_ACCOUNT,
  MAX_SNAPSHOT_BYTES,
  MAX_STORED_SITE_BYTES,
  OBJECT_ROW_BYTES,
  QUOTA_BYTES,
  SESSION_OBJECT_ROW_BYTES,
  SESSION_ROW_BYTES,
  SESSION_TTL_MS,
  SITE_ROW_BYTES,
  VERSION_ROW_BYTES,
} from "../lib/publish-limits";
import {
  storedPlan,
  type BeginPublishRequest,
  type BeginPublishResponse,
  type CompletePublishResponse,
  type PublishSessionResponse,
  type SiteStatus,
  type StoredPlan,
  type UploadInstruction,
} from "../lib/publish.schemas";
import { makeSlug, randomSuffix } from "../lib/slug";
import {
  blobKey,
  makeUrlSigner,
  r2ObjectStore,
  siteContentKey,
  sourceKey,
  type BucketName,
  type ObjectInfo,
  type ObjectStore,
  type UrlSigner,
} from "../lib/storage";
import {
  accountRowBytes,
  d1PublishStore,
  largeFileRowBytes,
  PLAN_RESERVED_ROW_BYTES_KEY,
  siteFileRowBytes,
  type ObjectKind,
  type ObjectRef,
  type PublishStore,
  type SessionRow,
  type SiteRow,
  type SizedObjectRef,
  type StoredObjectRow,
} from "./publish.store";
import { syncPointer } from "./site-pointer";

// Publish: begin -> the client PUTs what begin asked for -> complete.
//
// Begin validates the plan, finds or creates the workspace's site, works out
// which objects the server lacks (the snapshot's source and blobs, and the
// site files' contents, each content-addressed per account), records a
// session that holds its objects for as long as its upload URLs work, and
// signs those URLs. Complete verifies every object of the session, commits
// the version row and its site files under a guard that fails the whole batch
// if the head moved, the lock was lost or an object vanished, and then writes
// the site's pointer (site-pointer.ts): that one put is the moment visitors
// switch over. Nothing a visitor sees changes before it, so a failed or
// cancelled publish leaves the site as it was. See the spec's §2 and §11 for
// the contract and §3 for the SQL (publish.store.ts).

// Tests shrink these.
export type PublishCaps = { accountRowBytes: number; beginHeads: number };
const PUBLISH_CAPS: PublishCaps = {
  accountRowBytes: MAX_ACCOUNT_ROW_BYTES,
  beginHeads: MAX_BEGIN_HEADS,
};

export type PublishDeps = {
  store: PublishStore;
  sites: ObjectStore;
  sources: ObjectStore;
  signer: UrlSigner;
  publishLimiter: RateLimit;
  remixLimiter: RateLimit;
  completeLimiter: RateLimit;
  siteUrl: (slug: string) => string;
  now: () => Date;
  newId: (prefix: "site" | "pub" | "ver") => string;
  slugSuffix: () => string;
  caps?: Partial<PublishCaps>;
};

// ---------------------------------------------------------------------------
// Wiring

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const randomId = (prefix: string, length = 24) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return `${prefix}_${[...bytes].map((b) => ID_ALPHABET[b % 32]).join("")}`;
};

// The site domain: SITE_URL_TEMPLATE's hostname with the "{slug}." label
// removed ("https://{slug}.antidraw.app" -> "antidraw.app").
export const siteDomain = (template: string): string | null => {
  try {
    const host = new URL(template.replace("{slug}", "slug-placeholder")).hostname;
    return host.startsWith("slug-placeholder.") ? host.slice("slug-placeholder.".length) : null;
  } catch {
    return null;
  }
};

// Published sites run arbitrary JS under the site domain and can set cookies
// on it (until it is on the Public Suffix List), so the auth server must
// never live there.
export const checkSiteDomainConfig = (env: Bindings): Result<void, ApiError> => {
  const domain = siteDomain(env.SITE_URL_TEMPLATE ?? "");
  if (!domain) {
    return err(
      apiError(500, "CONFIG_INVALID", "SITE_URL_TEMPLATE must look like https://{slug}.<domain>"),
    );
  }
  let authHost: string;
  try {
    authHost = new URL(env.BETTER_AUTH_URL).hostname;
  } catch {
    return err(apiError(500, "CONFIG_INVALID", "BETTER_AUTH_URL is not a URL"));
  }
  if (domain !== "localhost" && (authHost === domain || authHost.endsWith(`.${domain}`))) {
    return err(
      apiError(500, "CONFIG_INVALID", "BETTER_AUTH_URL must not be a host under the site domain"),
    );
  }
  return ok(undefined);
};

export const makePublishDeps = (env: Bindings): Result<PublishDeps, ApiError> => {
  const now = () => new Date();
  return checkSiteDomainConfig(env)
    .andThen(() => makeUrlSigner(env, now))
    .map((signer) => ({
      store: d1PublishStore(getDb(env)),
      sites: r2ObjectStore(env.SITES),
      sources: r2ObjectStore(env.SOURCES),
      signer,
      publishLimiter: env.PUBLISH_RATE_LIMITER,
      remixLimiter: env.REMIX_RATE_LIMITER,
      completeLimiter: env.COMPLETE_RATE_LIMITER,
      siteUrl: (slug: string) => env.SITE_URL_TEMPLATE.replace("{slug}", slug),
      now,
      newId: (prefix: string) => randomId(prefix),
      slugSuffix: randomSuffix,
    }));
};

// ---------------------------------------------------------------------------
// Shared helpers

const storeFailure = (error: unknown) => {
  console.error(error);
  return apiError(500, "PUBLISH_STORE_FAILED", "Could not reach publish storage");
};

// Runs a service body that returns a Result, turning a throw (D1, R2) into a
// 500 in the envelope rather than an unhandled rejection.
export const run = <T>(body: () => Promise<Result<T, ApiError>>): ResultAsync<T, ApiError> =>
  ResultAsync.fromPromise(body(), storeFailure).andThen((result) => result);

const notFound = () => apiError(404, "PUBLISH_NOT_FOUND", "Publish session not found");
const siteNotFound = () => apiError(404, "SITE_NOT_FOUND", "Site not found");
const invalidPath = (paths: string[]) =>
  apiError(422, "INVALID_PATH", "Some paths cannot be published", { paths: paths.slice(0, 50) });
const invalidRequest = (message: string, details?: unknown) =>
  apiError(400, "INVALID_REQUEST", message, details);

// Where an account object lives.
export const objectLocation = (
  userId: string,
  o: ObjectRef,
): { bucket: BucketName; key: string } =>
  o.kind === "source"
    ? { bucket: "sources", key: sourceKey(userId, o.sha256) }
    : o.kind === "blob"
      ? { bucket: "sources", key: blobKey(userId, o.sha256) }
      : { bucket: "sites", key: siteContentKey(userId, o.sha256) };
const refKey = (o: ObjectRef) => `${o.kind}:${o.sha256}`;

const headObject = (deps: PublishDeps, userId: string, o: ObjectRef) => {
  const { bucket, key } = objectLocation(userId, o);
  return (bucket === "sites" ? deps.sites : deps.sources).head(key);
};

// What a HEAD found: the object's info, null when R2 has no such key, or
// "unchecked" when R2 failed twice. R2 now and then answers a transient error
// (10001, "try again"): among the thousands of HEADs of a first publish one
// is likely, and it must not sink the others.
const tryHead = async (
  deps: PublishDeps,
  userId: string,
  o: ObjectRef,
): Promise<ObjectInfo | null | "unchecked"> => {
  try {
    return await headObject(deps, userId, o);
  } catch {
    try {
      return await headObject(deps, userId, o);
    } catch (error) {
      console.error(`publish: HEAD of ${o.kind} ${o.sha256} failed twice`, error);
      return "unchecked";
    }
  }
};
const isObject = (info: ObjectInfo | null | "unchecked", o: SizedObjectRef) =>
  info !== null && info !== "unchecked" && info.size === o.size && info.sha256 === o.sha256;

// Runs `fn` over `items` with at most `limit` in flight (R2 HEADs).
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};
// Workers run about 6 subrequests of an invocation at once and queue the
// rest, so this bounds what is queued rather than what runs: HEADs cost about
// (count / 6) round trips, hence the effort to skip them (findMissing).
const HEAD_CONCURRENCY = 50;

// Every account object a plan needs: its source archive, each distinct blob
// and each distinct site file content.
const planObjects = (
  plan: Pick<StoredPlan, "source" | "largeFiles" | "site">,
): SizedObjectRef[] => {
  const blobs = new Map<string, SizedObjectRef>();
  for (const f of plan.largeFiles) {
    blobs.set(f.sha256, { kind: "blob", sha256: f.sha256, size: f.size });
  }
  const contents = new Map<string, SizedObjectRef>();
  for (const f of plan.site.files) {
    if (!contents.has(f.sha256))
      contents.set(f.sha256, { kind: "site", sha256: f.sha256, size: f.size });
  }
  return [
    { kind: "source", sha256: plan.source.sha256, size: plan.source.size },
    ...blobs.values(),
    ...contents.values(),
  ];
};

// The D1 footprint the plan's version would keep: a row per large file and
// per site file (the version's file_row_bytes).
const planRowBytes = (plan: Pick<StoredPlan, "largeFiles" | "site">) =>
  plan.largeFiles.reduce((a, f) => a + largeFileRowBytes(f), 0) +
  plan.site.files.reduce((a, f) => a + siteFileRowBytes(f), 0);

// A site path whose content is `sha256`, to name it in an upload or a miss.
const sitePathOf = (plan: Pick<StoredPlan, "site">, sha256: string) =>
  plan.site.files.find((f) => f.sha256 === sha256)?.path;

export const parsePlan = (raw: string): StoredPlan | null => {
  try {
    const parsed = storedPlan.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const siteStatusOf = async (deps: PublishDeps, site: SiteRow): Promise<SiteStatus> => {
  const head = await deps.store.getHeadVersion(site);
  return {
    siteId: site.id,
    slug: site.slug,
    url: deps.siteUrl(site.slug),
    headVersion: site.headVersion,
    allowRemix: site.allowRemix,
    lastPublishedAt: head ? new Date(head.createdAt).toISOString() : null,
  };
};

// ---------------------------------------------------------------------------
// Begin

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const validateBegin = (req: BeginPublishRequest): Result<void, ApiError> => {
  const { snapshot, site } = req;

  const unpublishable = site.files
    .filter((f) => !isPublishableSitePath(f.path, f.immutable))
    .map((f) => f.path);
  if (unpublishable.length > 0) return err(invalidPath(unpublishable));

  const sitePaths = new Set(site.files.map((f) => f.path));
  const missingEntries = ENTRY_PATHS.filter((p) => !sitePaths.has(p));
  if (missingEntries.length > 0) {
    return err(
      invalidRequest("The site must include preview.html, canvas.json and index.html", {
        paths: missingEntries,
      }),
    );
  }

  const duplicates = (paths: string[], key: (p: string) => string = (p) => p) => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const p of paths) {
      const k = key(p);
      if (seen.has(k)) dups.push(p);
      else seen.set(k, p);
    }
    return dups;
  };
  const largePaths = snapshot.largeFiles.map((f) => f.path);
  const dupPaths = [
    ...duplicates(site.files.map((f) => f.path)),
    ...duplicates(largePaths),
    ...duplicates(largePaths, caseKey),
  ];
  if (dupPaths.length > 0) return err(invalidPath([...new Set(dupPaths)]));

  const excluded = largePaths.filter(isExcludedSnapshotPath);
  if (excluded.length > 0) return err(invalidPath(excluded));

  const blobSizes = new Map<string, number>();
  for (const f of snapshot.largeFiles) {
    const seen = blobSizes.get(f.sha256);
    if (seen !== undefined && seen !== f.size) {
      return err(invalidRequest("A blob sha256 appears with two sizes", { sha256: f.sha256 }));
    }
    blobSizes.set(f.sha256, f.size);
  }
  // A file of no bytes has one possible content: anything else declared at
  // size 0 is a row nothing could ever upload.
  const notEmpty = site.files.filter((f) => f.size === 0 && f.sha256 !== EMPTY_SHA256);
  if (notEmpty.length > 0) {
    return err(
      invalidRequest("An empty site file must have the empty content's sha256", {
        paths: notEmpty.slice(0, 50).map((f) => f.path),
      }),
    );
  }
  const contentSizes = new Map<string, number>();
  for (const f of site.files) {
    const seen = contentSizes.get(f.sha256);
    if (seen !== undefined && seen !== f.size) {
      return err(invalidRequest("A site file sha256 appears with two sizes", { sha256: f.sha256 }));
    }
    contentSizes.set(f.sha256, f.size);
  }

  const snapshotBytes = snapshot.source.size + [...blobSizes.values()].reduce((a, b) => a + b, 0);
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    return err(
      apiError(413, "PUBLISH_TOO_LARGE", "The snapshot is too large to publish", {
        limitBytes: MAX_SNAPSHOT_BYTES,
        snapshotBytes,
      }),
    );
  }

  const siteBytes = site.files.reduce((a, f) => a + f.size, 0);
  if (siteBytes > MAX_SITE_BYTES) {
    return err(
      apiError(413, "SITE_TOO_LARGE", "The site is too large to publish", {
        limitBytes: MAX_SITE_BYTES,
        siteBytes,
        siteFileCount: site.files.length,
      }),
    );
  }
  return ok(undefined);
};

const SLUG_ATTEMPTS = 5;

// Finds the workspace's site, or creates it. Creation is race-safe: a
// concurrent begin for the same workspace makes the insert a no-op, and this
// one continues with the site the other created.
const findOrCreateSite = async (
  deps: PublishDeps,
  userId: string,
  req: BeginPublishRequest,
): Promise<Result<SiteRow, ApiError>> => {
  let site = await deps.store.findSiteByWorkspace(userId, req.clientWorkspaceId);
  if (!site) {
    if ((await deps.store.countSites(userId)) >= MAX_SITES_PER_ACCOUNT) {
      return err(
        apiError(403, "SITE_LIMIT", `You can publish at most ${MAX_SITES_PER_ACCOUNT} canvases`, {
          limit: MAX_SITES_PER_ACCOUNT,
        }),
      );
    }
    let outcome: "inserted" | "exists" | "slug-taken" = "slug-taken";
    for (let attempt = 0; attempt < SLUG_ATTEMPTS && outcome === "slug-taken"; attempt++) {
      outcome = await deps.store.insertSiteIfAbsent({
        id: deps.newId("site"),
        userId,
        clientWorkspaceId: req.clientWorkspaceId,
        name: req.name,
        slug: makeSlug(req.name, deps.slugSuffix),
        allowRemix: req.allowRemix ?? true,
        now: deps.now().getTime(),
      });
    }
    if (outcome === "slug-taken") {
      return err(
        apiError(500, "SLUG_ALLOCATION_FAILED", "Could not allocate an address for the site"),
      );
    }
    site = await deps.store.findSiteByWorkspace(userId, req.clientWorkspaceId);
    if (!site) return err(storeFailure(new Error("site vanished after insert")));
    if (outcome === "inserted") return ok(site);
  }

  const renamed = site.name !== req.name;
  const remixChanged = req.allowRemix !== undefined && req.allowRemix !== site.allowRemix;
  if (!renamed && !remixChanged) return ok(site);
  const updated = await deps.store.updateSite(
    site.id,
    {
      ...(renamed ? { name: req.name } : {}),
      ...(remixChanged ? { allowRemix: req.allowRemix } : {}),
    },
    deps.now().getTime(),
  );
  return updated ? ok(updated) : err(storeFailure(new Error("site vanished during update")));
};

// What begin knows of an object from its row alone. `committed`: a commit
// verified it, so it is neither new nor pending. `row`: the row begin found
// ("none" when there was none, so begin's insert creates it). `stored`: the
// size its row counts toward the caps already (0 without a live row).
type ObjectState = SizedObjectRef & {
  committed: boolean;
  row: "none" | "deleting" | "verified" | "unverified";
  stored: number;
};
type ObjectNeed = ObjectState & { upload: boolean };

// The plan's objects as their rows describe them, without asking R2: every
// refusal that depends only on rows runs on this, before any HEAD.
const readObjects = async (
  deps: PublishDeps,
  userId: string,
  needed: SizedObjectRef[],
): Promise<Result<ObjectState[], ApiError>> => {
  const rows = new Map<string, StoredObjectRow>();
  for (const row of await deps.store.getStoredObjects(userId, needed)) rows.set(refKey(row), row);
  const states: ObjectState[] = [];
  for (const o of needed) {
    const row = rows.get(refKey(o));
    if (!row) states.push({ ...o, committed: false, row: "none", stored: 0 });
    else if (row.deleting) states.push({ ...o, committed: false, row: "deleting", stored: 0 });
    else if (row.verified) {
      if (row.size !== o.size) {
        return err(
          invalidRequest("An object was declared with another size", { sha256: o.sha256 }),
        );
      }
      states.push({ ...o, committed: true, row: "verified", stored: row.size });
    } else states.push({ ...o, committed: false, row: "unverified", stored: row.size });
  }
  return ok(states);
};

// Which account objects need an upload. A verified row is trusted (see
// findMissing). An object without a row is not in R2 either (GC deletes a
// key before its row, and a row goes without its key only when no session
// that could have uploaded it holds it), so it is asked for without a HEAD;
// only an unverified row is looked up in R2, so bytes an earlier session
// uploaded but never committed are not sent twice. At most `maxHeads` of
// them, the largest first: the rest are asked for again, which costs the
// client an upload rather than the operator an unbounded run of HEADs.
const resolveUploads = async (
  deps: PublishDeps,
  userId: string,
  objects: ObjectState[],
  maxHeads: number,
): Promise<ObjectNeed[]> => {
  const toHead = new Set(
    objects
      .filter((o) => o.row === "unverified")
      .sort((a, b) => b.size - a.size)
      .slice(0, Math.max(maxHeads, 0)),
  );
  return mapLimit(objects, HEAD_CONCURRENCY, async (o): Promise<ObjectNeed> => {
    if (o.row === "verified") return { ...o, upload: false };
    if (!toHead.has(o)) return { ...o, upload: true };
    // One R2 could not answer about is asked for again: sending the same
    // bytes twice is harmless, a begin failed by one HEAD is not.
    return { ...o, upload: !isObject(await tryHead(deps, userId, o), o) };
  });
};

const tooManyOpen = (count: number) =>
  apiError(
    429,
    "RATE_LIMITED",
    "Too many unfinished publishes. Finish or cancel one, or try again later.",
    { reason: "open-sessions", limit: MAX_OPEN_SESSIONS_PER_ACCOUNT, open: count },
  );

const siteStorageExceeded = (usedBytes: number, publishBytes: number) =>
  apiError(413, "QUOTA_EXCEEDED", "Your published sites use all the storage they are allowed.", {
    reason: "site-storage",
    quotaBytes: MAX_STORED_SITE_BYTES,
    usedBytes,
    publishBytes,
  });

// The account's rows (accountRowBytes), not its bytes: the files its sites'
// versions list and the objects and sessions it keeps.
const siteFilesExceeded = (quotaBytes: number, usedBytes: number, publishBytes: number) =>
  apiError(413, "QUOTA_EXCEEDED", "Your published sites have too many files between them.", {
    reason: "site-files",
    quotaBytes,
    usedBytes,
    publishBytes,
  });

const quotaExceeded = (usedBytes: number, publishBytes: number) =>
  apiError(413, "QUOTA_EXCEEDED", "This publish would exceed your storage quota", {
    quotaBytes: QUOTA_BYTES,
    usedBytes,
    publishBytes,
  });

const pendingSiteExceeded = (usedBytes: number, publishBytes: number) =>
  apiError(
    413,
    "QUOTA_EXCEEDED",
    "Too many site files are waiting on unfinished publishes. Try again later.",
    { reason: "pending-site", quotaBytes: MAX_PENDING_SITE_BYTES, usedBytes, publishBytes },
  );

// Every check begin makes before it asks R2 anything depends on D1 rows
// alone, so a refused begin costs no R2 call: the quota, site-storage,
// pending-site, account-rows and open-session checks run on the rows first,
// and again after the session's insert (which is what holds against
// concurrent begins). Only a begin that passed them all HEADs, and at most
// MAX_BEGIN_HEADS objects.
export const beginPublish = (
  deps: PublishDeps,
  userId: string,
  req: BeginPublishRequest,
): ResultAsync<BeginPublishResponse, ApiError> =>
  run(async () => {
    const caps = { ...PUBLISH_CAPS, ...deps.caps };
    const { success } = await deps.publishLimiter.limit({ key: userId });
    if (!success) {
      return err(apiError(429, "RATE_LIMITED", "Too many publishes. Try again in a minute."));
    }

    const valid = validateBegin(req);
    if (valid.isErr()) return err(valid.error);

    // Each open session keeps a plan of up to MAX_PLAN_JSON_BYTES in D1;
    // checked again after the insert, which is what holds against concurrent
    // begins.
    const openBefore = await deps.store.openSessions(userId, deps.now().getTime());
    if (openBefore.count >= MAX_OPEN_SESSIONS_PER_ACCOUNT) {
      return err(tooManyOpen(openBefore.count));
    }

    const plan: StoredPlan = {
      name: req.name,
      source: req.snapshot.source,
      largeFiles: req.snapshot.largeFiles,
      fileCount: req.snapshot.fileCount,
      uncompressedBytes: req.snapshot.uncompressedBytes,
      site: req.site,
    };
    const planBytes = utf8Bytes(JSON.stringify(plan));
    if (planBytes > MAX_PLAN_JSON_BYTES) {
      return err(
        apiError(413, "PUBLISH_TOO_LARGE", "The publish plan is too large", {
          reason: "plan",
          planBytes,
          limitBytes: MAX_PLAN_JSON_BYTES,
        }),
      );
    }

    const objectsResult = await readObjects(deps, userId, planObjects(plan));
    if (objectsResult.isErr()) return err(objectsResult.error);
    const objects = objectsResult.value;
    const added = (keep: (o: ObjectState) => boolean) =>
      objects.filter(keep).reduce((a, o) => a + Math.max(0, o.size - o.stored), 0);

    // What the account keeps in D1 (accountRowBytes): every retained version
    // keeps rows for its large files and site files (a plan's thousand large
    // files may all name one blob, costing no quota), every object a row, and
    // every session its row, plan and session objects. The session's plan
    // reserves its version's rows until the commit adds them.
    // (A site row is counted whether or not begin creates one: this check is
    // the cheap one, the one after the insert is exact.)
    const reservedRowBytes = planRowBytes(plan) + VERSION_ROW_BYTES;
    const rowsBefore = accountRowBytes(await deps.store.accountRows(userId));
    const rowsAdded =
      reservedRowBytes +
      SESSION_ROW_BYTES +
      planBytes +
      objects.length * SESSION_OBJECT_ROW_BYTES +
      objects.filter((o) => o.row === "none").length * OBJECT_ROW_BYTES +
      SITE_ROW_BYTES;
    if (rowsBefore + rowsAdded > caps.accountRowBytes) {
      return err(siteFilesExceeded(caps.accountRowBytes, rowsBefore, rowsAdded));
    }

    // Site contents are outside the quota, but what no commit has verified
    // counts toward the pending-site cap while the session holds, uploaded
    // by this session or by an earlier one that never committed.
    const siteUploadBytes = objects
      .filter((o) => o.kind === "site" && !o.committed)
      .reduce((a, o) => a + o.size, 0);
    if (openBefore.siteUploadBytes + siteUploadBytes > MAX_PENDING_SITE_BYTES) {
      return err(pendingSiteExceeded(openBefore.siteUploadBytes, siteUploadBytes));
    }
    const usedBefore = await deps.store.usedBytes(userId);
    const quotaAdded = added((o) => o.kind !== "site");
    if (usedBefore + quotaAdded > QUOTA_BYTES) {
      return err(quotaExceeded(usedBefore, quotaAdded));
    }
    const siteStoredBefore = await deps.store.storedSiteBytes(userId);
    const siteAdded = added((o) => o.kind === "site");
    if (siteAdded > 0 && siteStoredBefore + siteAdded > MAX_STORED_SITE_BYTES) {
      return err(siteStorageExceeded(siteStoredBefore, siteAdded));
    }

    const siteResult = await findOrCreateSite(deps, userId, req);
    if (siteResult.isErr()) return err(siteResult.error);
    const site = siteResult.value;

    const needs = await resolveUploads(deps, userId, objects, caps.beginHeads);

    const now = deps.now().getTime();
    const expiresAt = now + SESSION_TTL_MS;
    const sessionId = deps.newId("pub");
    const uploads = needs.filter((o) => o.upload);
    const objectUploads = uploads.filter((o) => o.kind !== "site");
    const siteUploads = uploads.filter((o) => o.kind === "site");
    await deps.store.createSession({
      id: sessionId,
      userId,
      siteId: site.id,
      baseVersion: site.headVersion,
      // The upload counts let abort tell a session that was never given any
      // URL (spec §10, Q9).
      plan: JSON.stringify({
        ...plan,
        objectUploads: objectUploads.length,
        siteUploads: siteUploads.length,
        [PLAN_RESERVED_ROW_BYTES_KEY]: reservedRowBytes,
      }),
      expiresAt,
      holdUntil: expiresAt,
      now,
      objects: objects.map(({ kind, sha256, size }) => ({ kind, sha256, size })),
      siteUploadBytes,
    });

    // No URL was issued and the client never learns the session's id, so a
    // refused session is deleted outright (its plan with it: kept, refused
    // begins would pile plans up in D1 outside the open-session cap), and
    // the rows this begin's insert created are released again. Only those:
    // an object that had a row before may have its bytes in R2, and a row
    // must not go while its key stays.
    const refuse = async (error: ApiError) => {
      await deps.store.discardSession(sessionId);
      await deps.store.releaseUnheldObjects(
        userId,
        objects.filter((o) => o.row === "none"),
        now,
      );
      return err(error);
    };
    const used = await deps.store.usedBytes(userId);
    if (used > QUOTA_BYTES) return refuse(quotaExceeded(usedBefore, used - usedBefore));
    // Checked after the insert, like the quota. A publish that adds no site
    // bytes (its contents all stored already) is let through at the cap.
    const siteStored = await deps.store.storedSiteBytes(userId);
    if (siteStored > MAX_STORED_SITE_BYTES && siteStored > siteStoredBefore) {
      return refuse(siteStorageExceeded(siteStoredBefore, siteStored - siteStoredBefore));
    }
    const rows = accountRowBytes(await deps.store.accountRows(userId));
    if (rows > caps.accountRowBytes) {
      return refuse(siteFilesExceeded(caps.accountRowBytes, rowsBefore, rows - rowsBefore));
    }
    const open = await deps.store.openSessions(userId, now);
    if (open.siteUploadBytes > MAX_PENDING_SITE_BYTES) {
      return refuse(pendingSiteExceeded(open.siteUploadBytes - siteUploadBytes, siteUploadBytes));
    }
    if (open.count > MAX_OPEN_SESSIONS_PER_ACCOUNT) {
      return refuse(tooManyOpen(open.count - 1));
    }

    const instructions: UploadInstruction[] = [];
    for (const o of uploads) {
      const { bucket, key } = objectLocation(userId, o);
      const signed = await deps.signer.uploadUrl({
        bucket,
        key,
        sha256: o.sha256,
        size: o.size,
        // A site content is served with its path's type from the pointer, so
        // the stored object's own type is never used.
        contentType: o.kind === "source" ? "application/gzip" : "application/octet-stream",
      });
      const path = o.kind === "site" ? sitePathOf(plan, o.sha256) : undefined;
      instructions.push({
        kind: o.kind,
        sha256: o.sha256,
        size: o.size,
        ...(path !== undefined ? { path } : {}),
        method: "PUT",
        ...signed,
      });
    }

    return ok({
      publish: {
        id: sessionId,
        siteId: site.id,
        slug: site.slug,
        url: deps.siteUrl(site.slug),
        baseVersion: site.headVersion,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      uploads: instructions,
    });
  });

// ---------------------------------------------------------------------------
// Complete

const conflict = () =>
  apiError(409, "PUBLISH_CONFLICT", "The site was published from somewhere else meanwhile");
const inProgress = () =>
  apiError(409, "PUBLISH_IN_PROGRESS", "Another publish of this site is finishing. Try again.");
const publishExpired = () =>
  apiError(410, "PUBLISH_EXPIRED", "This publish expired. Publish again.");
// UPLOAD_INCOMPLETE names at most this many missing objects, and complete
// stops looking once it has found them.
const MAX_REPORTED_MISSING = 50;
const uploadIncomplete = (missing: { kind: string; sha256: string; path?: string }[]) =>
  apiError(409, "UPLOAD_INCOMPLETE", "Some uploads did not arrive", {
    missing: missing.slice(0, MAX_REPORTED_MISSING),
  });

const loadOwnSession = async (
  deps: PublishDeps,
  userId: string,
  sessionId: string,
): Promise<Result<SessionRow, ApiError>> => {
  const session = await deps.store.getSession(sessionId);
  return session && session.userId === userId ? ok(session) : err(notFound());
};

// The session's own live lock can be taken again: it is one a request of
// this session left behind (the Worker died, or a D1 call failed where no
// release could run), and until it lapsed the session's retries would all be
// refused.
const claimLock = async (
  deps: PublishDeps,
  session: SessionRow,
): Promise<Result<SiteRow, ApiError>> => {
  const site = await deps.store.findSiteById(session.siteId);
  if (!site) return err(notFound());
  if (site.headVersion !== session.baseVersion) return err(conflict());
  const now = deps.now().getTime();
  const lockedByOther =
    site.completeLock !== null &&
    site.completeLock !== session.id &&
    (site.completeLockExpiresAt ?? 0) >= now;
  if (lockedByOther) return err(inProgress());
  const claimed = await deps.store.claimCompleteLock({
    siteId: site.id,
    sessionId: session.id,
    baseVersion: session.baseVersion,
    now,
    expiresAt: now + COMPLETE_LOCK_TTL_MS,
  });
  if (claimed) return ok(claimed);
  // Lost a race: re-read to say which one.
  const reread = await deps.store.findSiteById(session.siteId);
  if (!reread) return err(notFound());
  return err(reread.headVersion !== session.baseVersion ? conflict() : inProgress());
};

// Every account object the session references: its row is there, not being
// deleted and of the declared size, and R2 has the bytes. R2 is asked (a HEAD
// of size and sha256) only about objects whose bytes nothing has vouched for:
//
// - A verified row that is not deleting has its bytes in R2. A commit checked
//   them, keys are content-addressed and never rewritten, and the only thing
//   that deletes one is GC (gc.service.ts, collectObjects), which first marks
//   its row deleting (clearing verified) in the statement that checks nothing
//   references or holds it, and deletes the row only after the key. Should GC
//   mark it between here and the commit, the commit guard (deleting = 0)
//   fails the batch.
// - An object an earlier complete of this session found (`present`): the
//   session holds it since, so GC cannot have claimed it.
//
// Stops asking once MAX_REPORTED_MISSING are missing. What its HEADs find is
// pushed onto `confirmed` as they answer, for the caller to record for a
// retry. `unchecked`: objects R2 failed to answer about (tryHead).
const findMissing = async (
  deps: PublishDeps,
  session: SessionRow,
  plan: StoredPlan,
  confirmed: ObjectRef[],
) => {
  const objects = planObjects(plan);
  const rows = new Map<string, StoredObjectRow>();
  for (const row of await deps.store.getStoredObjects(session.userId, objects)) {
    rows.set(refKey(row), row);
  }
  const found = new Set((await deps.store.presentSessionObjects(session.id)).map(refKey));
  let missingCount = 0;
  let unchecked = 0;
  // true: present; false: missing; null: not looked at (enough were
  // missing), or R2 could not say.
  const checks = await mapLimit(objects, HEAD_CONCURRENCY, async (o): Promise<boolean | null> => {
    const row = rows.get(refKey(o));
    if (!row || row.deleting || row.size !== o.size) {
      missingCount++;
      return false;
    }
    if (row.verified || found.has(refKey(o))) return true;
    if (missingCount >= MAX_REPORTED_MISSING) return null;
    const info = await tryHead(deps, session.userId, o);
    if (info === "unchecked") {
      unchecked++;
      return null;
    }
    const present = isObject(info, o);
    if (present) confirmed.push({ kind: o.kind, sha256: o.sha256 });
    else missingCount++;
    return present;
  });
  const missing: { kind: ObjectKind; sha256: string; path?: string }[] = [];
  objects.forEach((o, i) => {
    if (checks[i] !== false) return;
    const path = o.kind === "site" ? sitePathOf(plan, o.sha256) : undefined;
    missing.push({ kind: o.kind, sha256: o.sha256, ...(path !== undefined ? { path } : {}) });
  });
  return { missing, unchecked };
};

// Retryable (5xx): the next attempt HEADs only what this one did not find.
const storageUnavailable = () =>
  apiError(503, "STORAGE_FAILED", "Could not check every upload with storage. Try again.");

const switchFailed = () =>
  apiError(
    500,
    "STORAGE_FAILED",
    "The publish was saved, but the site could not be switched over to it yet. Try again.",
  );

// Brings the site's pointer up to its head version when it is behind (a
// commit whose pointer write failed, or has not happened yet). Complete is
// answered only once visitors see the version, so a retry of a committed
// session re-syncs here.
const ensurePointer = async (deps: PublishDeps, site: SiteRow): Promise<Result<void, ApiError>> => {
  if (site.pointerVersion >= site.headVersion) return ok(undefined);
  try {
    const outcome = await syncPointer(deps, site);
    if (outcome === "raced") return err(switchFailed());
  } catch (error) {
    console.error(error);
    return err(switchFailed());
  }
  return ok(undefined);
};

// The answer for a session that has committed: complete is idempotent.
const completedResult = async (
  deps: PublishDeps,
  session: SessionRow,
): Promise<Result<CompletePublishResponse, ApiError> | null> => {
  if (session.status !== "completed" || session.resultVersion === null) return null;
  const site = await deps.store.findSiteById(session.siteId);
  if (!site) return err(notFound());
  const synced = await ensurePointer(deps, site);
  if (synced.isErr()) return err(synced.error);
  return ok({ site: await siteStatusOf(deps, site), version: session.resultVersion });
};

// A conflict may be this session's own commit, made by another request of it
// (a retry racing the request it retried).
const conflictOrCompleted = async (
  deps: PublishDeps,
  sessionId: string,
): Promise<Result<CompletePublishResponse, ApiError>> => {
  const session = await deps.store.getSession(sessionId);
  return (session && (await completedResult(deps, session))) ?? err(conflict());
};

// Verification and the commit, under the lock `claimLock` took. Every way out
// that does not commit releases the lock, a throw included (run() turns that
// into a 500), so a failed complete never leaves the site locked. Nothing is
// written to the sites bucket here: the pointer follows the commit.
const verifyAndCommit = async (
  deps: PublishDeps,
  session: SessionRow,
  site: SiteRow,
  plan: StoredPlan,
): Promise<Result<void, ApiError>> => {
  const release = () => deps.store.releaseCompleteLock(site.id, session.id);
  // What this attempt's HEADs found. However it ends short of a commit (an
  // upload missing, a HEAD R2 failed, the commit refused or a throw), that
  // is recorded, best effort, so the next attempt does not HEAD it again:
  // each attempt then makes progress, rather than having to get thousands of
  // HEADs and the commit through in one go.
  const confirmed: ObjectRef[] = [];
  const remember = async () => {
    if (confirmed.length === 0) return;
    try {
      await deps.store.markSessionObjectsPresent(session.id, confirmed);
    } catch (error) {
      console.error(error);
    }
  };
  try {
    const scan = await findMissing(deps, session, plan, confirmed);
    if (scan.missing.length > 0 || scan.unchecked > 0) {
      await remember();
      await release();
      return err(scan.missing.length > 0 ? uploadIncomplete(scan.missing) : storageUnavailable());
    }

    const objects = planObjects(plan);
    const blobs = objects.filter((o) => o.kind === "blob");
    const committed = await deps.store.commitVersion({
      id: deps.newId("ver"),
      siteId: site.id,
      userId: session.userId,
      sessionId: session.id,
      baseVersion: session.baseVersion,
      source: plan.source,
      snapshotBytes: plan.source.size + blobs.reduce((a, b) => a + b.size, 0),
      fileCount: plan.fileCount,
      siteFileCount: plan.site.files.length,
      siteBytes: plan.site.files.reduce((a, f) => a + f.size, 0),
      largeFiles: plan.largeFiles.map(({ path, sha256, size, mode }) => ({
        path,
        sha256,
        size,
        mode,
      })),
      siteFiles: plan.site.files.map(({ path, sha256, size, contentType, immutable }) => ({
        path,
        sha256,
        size,
        contentType,
        // The build's word, and only where such files are named: the Worker
        // caches these for a year, and they are an older version's grace
        // entries. A public file whose name looks hashed is neither.
        immutable: immutable && isImmutableSitePath(path),
      })),
      fileRowBytes: planRowBytes(plan),
      keepVersions: KEEP_VERSIONS,
      now: deps.now().getTime(),
      // begin created one session object per plan object.
      sessionObjects: objects.length,
    });
    if (committed.ok) return ok(undefined);

    await remember();
    await release();
    switch (committed.reason) {
      case "conflict":
        return (await conflictOrCompleted(deps, session.id)).map(() => undefined);
      case "expired":
        return err(publishExpired());
      case "objects-gone":
        return err(uploadIncomplete(committed.missing));
      case "lock-lost":
        return err(inProgress());
      default:
        return err(storeFailure(committed.error));
    }
  } catch (error) {
    await remember();
    try {
      await release();
    } catch (releaseError) {
      console.error(releaseError);
    }
    throw error;
  }
};

export const completePublish = (
  deps: PublishDeps,
  userId: string,
  sessionId: string,
): ResultAsync<CompletePublishResponse, ApiError> =>
  run(async () => {
    const sessionResult = await loadOwnSession(deps, userId, sessionId);
    if (sessionResult.isErr()) return err(sessionResult.error);
    const session = sessionResult.value;

    const done = await completedResult(deps, session);
    if (done) return done;
    if (session.status !== "pending" || session.expiresAt < deps.now().getTime()) {
      return err(publishExpired());
    }
    const plan = parsePlan(session.plan);
    if (!plan) return err(storeFailure(new Error(`unreadable plan for ${session.id}`)));

    // Verification costs an R2 HEAD per object no commit has verified and no
    // earlier attempt found: up to ~6 000 on a first publish.
    const { success } = await deps.completeLimiter.limit({ key: userId });
    if (!success) {
      return err(
        apiError(429, "RATE_LIMITED", "Too many publish attempts. Try again in a minute."),
      );
    }

    const locked = await claimLock(deps, session);
    if (locked.isErr()) {
      return locked.error.code === "PUBLISH_CONFLICT"
        ? conflictOrCompleted(deps, session.id)
        : err(locked.error);
    }
    const site = locked.value;
    const committed = await verifyAndCommit(deps, session, site, plan);
    if (committed.isErr()) return err(committed.error);

    // The switch-over. Should it fail, the version is committed but not yet
    // live: the app's retry of complete, or GC's hourly re-sync, writes it.
    const updated = await deps.store.findSiteById(site.id);
    if (!updated) return err(notFound());
    const synced = await ensurePointer(deps, updated);
    if (synced.isErr()) return err(synced.error);
    return ok({ site: await siteStatusOf(deps, updated), version: session.baseVersion + 1 });
  });

// ---------------------------------------------------------------------------
// Session status, abort, site status

export const getPublishSession = (
  deps: PublishDeps,
  userId: string,
  sessionId: string,
): ResultAsync<PublishSessionResponse, ApiError> =>
  run(async () => {
    const sessionResult = await loadOwnSession(deps, userId, sessionId);
    if (sessionResult.isErr()) return err(sessionResult.error);
    const session = sessionResult.value;
    let site = await deps.store.findSiteById(session.siteId);
    if (!site) return err(notFound());
    const committed = session.status === "completed" ? session.resultVersion : null;
    const isLive = (s: SiteRow) => committed !== null && s.pointerVersion >= committed;
    // Committed but not switched over (the complete that committed it failed
    // to write the pointer, and nothing has retried since): re-sync here, as
    // a retry of complete would, rather than leave visitors on the old
    // version until GC's hourly re-sync. A failure just answers not live.
    if (committed !== null && !isLive(site)) {
      const { success } = await deps.completeLimiter.limit({ key: userId });
      if (success && (await ensurePointer(deps, site)).isOk()) {
        site = (await deps.store.findSiteById(site.id)) ?? site;
      }
    }
    // GC marks lapsed sessions expired hourly; report it straight away.
    const status =
      session.status === "pending" && session.expiresAt < deps.now().getTime()
        ? "expired"
        : session.status;
    return ok({
      status,
      resultVersion: session.resultVersion,
      live: isLive(site),
      site: await siteStatusOf(deps, site),
    });
  });

// Upload URLs already handed out stay usable until they expire and cannot be
// revoked, so an abort keeps the session's hold: its objects stay safe from
// GC and its site bytes counted until then. A session that was never given
// any URL has nothing in flight, and its hold ends at once (spec §10, Q9).
// Nothing visitors see changed, whatever it uploaded.
export const abortPublish = (
  deps: PublishDeps,
  userId: string,
  sessionId: string,
): ResultAsync<{ ok: true }, ApiError> =>
  run(async () => {
    const sessionResult = await loadOwnSession(deps, userId, sessionId);
    if (sessionResult.isErr()) return err(sessionResult.error);
    const session = sessionResult.value;
    if (session.status !== "pending") return ok({ ok: true as const });

    let plan: { objectUploads?: unknown; siteUploads?: unknown } = {};
    try {
      plan = JSON.parse(session.plan) as typeof plan;
    } catch {
      // Unreadable: keep the hold.
    }
    const releaseHold = plan.objectUploads === 0 && plan.siteUploads === 0;
    // A released session no longer counts as open, so its plan and session
    // objects go now rather than at GC's next retire: begin + abort of a
    // publish that needs no upload is cheap to repeat.
    await deps.store.setSessionStatus(session.id, "aborted", {
      onlyIfPending: true,
      ...(releaseHold
        ? { holdUntil: Math.min(session.holdUntil, deps.now().getTime()), retire: true }
        : {}),
    });
    return ok({ ok: true as const });
  });

export const getSiteStatus = (
  deps: PublishDeps,
  userId: string,
  clientWorkspaceId: string,
): ResultAsync<{ site: SiteStatus | null }, ApiError> =>
  run(async () => {
    const site = await deps.store.findSiteByWorkspace(userId, clientWorkspaceId);
    return ok({ site: site ? await siteStatusOf(deps, site) : null });
  });

// The one server-owned remix setting. It applies at once, and a publish
// already in flight cannot undo it: begin writes the setting only when the
// request carries an explicit allowRemix.
export const setAllowRemix = (
  deps: PublishDeps,
  userId: string,
  siteId: string,
  allowRemix: boolean,
): ResultAsync<{ site: SiteStatus }, ApiError> =>
  run(async () => {
    const site = await deps.store.findSiteById(siteId);
    if (!site || site.userId !== userId) return err(siteNotFound());
    const updated =
      site.allowRemix === allowRemix
        ? site
        : await deps.store.updateSite(site.id, { allowRemix }, deps.now().getTime());
    if (!updated) return err(siteNotFound());
    return ok({ site: await siteStatusOf(deps, updated) });
  });

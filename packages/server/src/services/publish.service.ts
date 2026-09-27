import { err, ok, ResultAsync, type Result } from "neverthrow";
import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { apiError, type ApiError } from "../lib/errors";
import {
  caseKey,
  ENTRY_PATHS,
  isExcludedSnapshotPath,
  isPublishableSitePath,
  utf8Bytes,
} from "../lib/paths";
import {
  COMPLETE_FENCE_MS,
  COMPLETE_LOCK_TTL_MS,
  IMMUTABLE_CACHE_CONTROL,
  KEEP_VERSIONS,
  MAX_OPEN_SESSIONS_PER_ACCOUNT,
  MAX_PENDING_SITE_BYTES,
  MAX_PLAN_JSON_BYTES,
  MAX_PROTECTED_JSON_BYTES,
  MAX_SITE_BYTES,
  MAX_SITE_ROW_PATHS_BYTES,
  MAX_SITE_STORED_BYTES,
  MAX_SITE_STORED_FILES,
  MAX_SITES_PER_ACCOUNT,
  MAX_SNAPSHOT_BYTES,
  QUOTA_BYTES,
  SESSION_TTL_MS,
  SITE_CLEANUP_DELAY_MS,
} from "../lib/publish-limits";
import {
  storedPlan,
  type BeginPublishRequest,
  type BeginPublishResponse,
  type CompletePublishRequest,
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
  siteKey,
  sourceKey,
  type ObjectInfo,
  type ObjectStore,
  type UrlSigner,
} from "../lib/storage";
import {
  d1PublishStore,
  type ObjectKind,
  type ObjectRef,
  type PublishStore,
  type SessionRow,
  type SiteRow,
  type SizedObjectRef,
  type StoredObjectRow,
} from "./publish.store";

// Publish: begin -> the client PUTs what begin asked for -> complete.
//
// Begin validates the plan, finds or creates the workspace's site, works out
// which objects the server lacks, records a session that holds its objects
// for as long as its upload URLs work, and signs those URLs. Complete
// verifies every referenced object, writes the three entry files (the moment
// the pages switch), then commits the version row under a guard that fails
// the whole batch if the head moved, the lock was lost or an object vanished.
// See the spec's §2 for the contract and §3 for the SQL (publish.store.ts).

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

const objectKey = (userId: string, o: ObjectRef) =>
  o.kind === "source" ? sourceKey(userId, o.sha256) : blobKey(userId, o.sha256);
const refKey = (o: ObjectRef) => `${o.kind}:${o.sha256}`;

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256Of = async (bytes: Uint8Array) =>
  toHex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

const decodeBase64 = (text: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
};

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
const HEAD_CONCURRENCY = 50;

const listByKey = async (store: ObjectStore, prefix: string) => {
  const byKey = new Map<string, ObjectInfo>();
  for await (const info of store.list(prefix)) byKey.set(info.key, info);
  return byKey;
};

// Every account object a plan needs: its source archive and each distinct blob.
const planObjects = (plan: Pick<StoredPlan, "source" | "largeFiles">): SizedObjectRef[] => {
  const blobs = new Map<string, SizedObjectRef>();
  for (const f of plan.largeFiles) {
    blobs.set(f.sha256, { kind: "blob", sha256: f.sha256, size: f.size });
  }
  return [
    { kind: "source", sha256: plan.source.sha256, size: plan.source.size },
    ...blobs.values(),
  ];
};

export const planSitePaths = (plan: Pick<StoredPlan, "site">) => [
  ...plan.site.files.map((f) => f.path),
  ...plan.site.entries.map((e) => e.path),
];

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

const validateBegin = (req: BeginPublishRequest): Result<void, ApiError> => {
  const { snapshot, site } = req;

  const unpublishable = site.files
    .filter((f) => !isPublishableSitePath(f.path, f.immutable))
    .map((f) => f.path);
  if (unpublishable.length > 0) return err(invalidPath(unpublishable));

  if (new Set(site.entries.map((e) => e.path)).size !== ENTRY_PATHS.length) {
    return err(invalidRequest("entries must be preview.html, canvas.json and index.html"));
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

  const snapshotBytes = snapshot.source.size + [...blobSizes.values()].reduce((a, b) => a + b, 0);
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    return err(
      apiError(413, "PUBLISH_TOO_LARGE", "The snapshot is too large to publish", {
        limitBytes: MAX_SNAPSHOT_BYTES,
        snapshotBytes,
      }),
    );
  }

  const siteBytes =
    site.files.reduce((a, f) => a + f.size, 0) + site.entries.reduce((a, e) => a + e.size, 0);
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

type ObjectNeed = SizedObjectRef & { upload: boolean };

// Which account objects need an upload. A verified row is trusted (complete
// re-checks it anyway); a missing or unverified one is looked up in R2, so
// bytes an earlier session uploaded but never committed are not sent twice.
const resolveObjects = async (
  deps: PublishDeps,
  userId: string,
  needed: SizedObjectRef[],
): Promise<Result<ObjectNeed[], ApiError>> => {
  const rows = new Map<string, StoredObjectRow>();
  for (const row of await deps.store.getStoredObjects(userId, needed)) rows.set(refKey(row), row);

  for (const o of needed) {
    const row = rows.get(refKey(o));
    if (row?.verified && !row.deleting && row.size !== o.size) {
      return err(invalidRequest("An object was declared with another size", { sha256: o.sha256 }));
    }
  }
  return ok(
    await mapLimit(needed, HEAD_CONCURRENCY, async (o): Promise<ObjectNeed> => {
      const row = rows.get(refKey(o));
      if (row?.deleting) return { ...o, upload: true }; // GC is removing it
      if (row?.verified) return { ...o, upload: false };
      const info = await deps.sources.head(objectKey(userId, o));
      const present = info !== null && info.size === o.size && info.sha256 === o.sha256;
      return { ...o, upload: !present };
    }),
  );
};

const siteCacheControl = (immutable: boolean) => (immutable ? IMMUTABLE_CACHE_CONTROL : undefined);

const tooManyOpen = (count: number) =>
  apiError(
    429,
    "RATE_LIMITED",
    "Too many unfinished publishes. Finish or cancel one, or try again later.",
    { reason: "open-sessions", limit: MAX_OPEN_SESSIONS_PER_ACCOUNT, open: count },
  );

const pendingSiteExceeded = (usedBytes: number, publishBytes: number) =>
  apiError(
    413,
    "QUOTA_EXCEEDED",
    "Too many site files are waiting on unfinished publishes. Try again later.",
    { reason: "pending-site", quotaBytes: MAX_PENDING_SITE_BYTES, usedBytes, publishBytes },
  );

// What <slug>/ would hold once this begin's uploads and entries land: every
// key already there that they do not replace, plus them.
const storedAfter = (
  existing: Map<string, ObjectInfo>,
  slug: string,
  writes: { path: string; size: number }[],
) => {
  const replaced = new Set(writes.map((w) => siteKey(slug, w.path)));
  let bytes = writes.reduce((a, w) => a + w.size, 0);
  let files = writes.length;
  for (const [key, info] of existing) {
    if (replaced.has(key)) continue;
    bytes += info.size;
    files++;
  }
  return { bytes, files };
};

export const beginPublish = (
  deps: PublishDeps,
  userId: string,
  req: BeginPublishRequest,
): ResultAsync<BeginPublishResponse, ApiError> =>
  run(async () => {
    const { success } = await deps.publishLimiter.limit({ key: userId });
    if (!success) {
      return err(apiError(429, "RATE_LIMITED", "Too many publishes. Try again in a minute."));
    }

    const valid = validateBegin(req);
    if (valid.isErr()) return err(valid.error);

    // Each open session keeps a plan of up to MAX_PLAN_JSON_BYTES in D1, and
    // GC reads every held one of a site; checked again after the insert, which
    // is what holds against concurrent begins.
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

    const siteResult = await findOrCreateSite(deps, userId, req);
    if (siteResult.isErr()) return err(siteResult.error);
    const site = siteResult.value;

    const objectsResult = await resolveObjects(deps, userId, planObjects(plan));
    if (objectsResult.isErr()) return err(objectsResult.error);
    const objects = objectsResult.value;

    const existing = await listByKey(deps.sites, `${site.slug}/`);
    const siteUploads = req.site.files.filter((f) => {
      const info = existing.get(siteKey(site.slug, f.path));
      return !(
        info &&
        info.sha256 === f.sha256 &&
        info.size === f.size &&
        info.contentType === f.contentType &&
        info.cacheControl === siteCacheControl(f.immutable)
      );
    });

    // MAX_SITE_BYTES bounds one plan; this bounds what the prefix holds, so
    // new paths cannot pile up faster than GC removes the stale ones.
    const stored = storedAfter(existing, site.slug, [...siteUploads, ...req.site.entries]);
    if (stored.bytes > MAX_SITE_STORED_BYTES || stored.files > MAX_SITE_STORED_FILES) {
      return err(
        apiError(
          413,
          "SITE_TOO_LARGE",
          "This site's earlier files have not been cleaned up yet. Try again in an hour.",
          {
            reason: "stored",
            limitBytes: MAX_SITE_STORED_BYTES,
            siteBytes: stored.bytes,
            limitFiles: MAX_SITE_STORED_FILES,
            siteFileCount: stored.files,
          },
        ),
      );
    }

    const siteUploadBytes = siteUploads.reduce((a, f) => a + f.size, 0);
    if (openBefore.siteUploadBytes + siteUploadBytes > MAX_PENDING_SITE_BYTES) {
      return err(pendingSiteExceeded(openBefore.siteUploadBytes, siteUploadBytes));
    }

    const now = deps.now().getTime();
    const expiresAt = now + SESSION_TTL_MS;
    const sessionId = deps.newId("pub");
    const objectUploads = objects.filter((o) => o.upload);
    const usedBefore = await deps.store.usedBytes(userId);
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
      }),
      expiresAt,
      holdUntil: expiresAt,
      now,
      objects: objects.map(({ kind, sha256, size }) => ({ kind, sha256, size })),
      siteUploadBytes,
      cleanupAfter: expiresAt + SITE_CLEANUP_DELAY_MS,
    });

    // No URL was issued, so a refused session holds nothing, and rows only
    // this begin needed (for objects R2 does not have) are released again.
    const refuse = async (error: ApiError) => {
      await deps.store.setSessionStatus(sessionId, "aborted", { holdUntil: 0 });
      await deps.store.releaseUnheldObjects(userId, objectUploads, now);
      return err(error);
    };
    const used = await deps.store.usedBytes(userId);
    if (used > QUOTA_BYTES) {
      return refuse(
        apiError(413, "QUOTA_EXCEEDED", "This publish would exceed your storage quota", {
          quotaBytes: QUOTA_BYTES,
          usedBytes: usedBefore,
          publishBytes: used - usedBefore,
        }),
      );
    }
    const open = await deps.store.openSessions(userId, now);
    if (open.siteUploadBytes > MAX_PENDING_SITE_BYTES) {
      return refuse(pendingSiteExceeded(open.siteUploadBytes - siteUploadBytes, siteUploadBytes));
    }
    if (open.count > MAX_OPEN_SESSIONS_PER_ACCOUNT) {
      return refuse(tooManyOpen(open.count - 1));
    }

    const uploads: UploadInstruction[] = [];
    for (const o of objectUploads) {
      const signed = await deps.signer.uploadUrl({
        bucket: "sources",
        key: objectKey(userId, o),
        sha256: o.sha256,
        size: o.size,
        contentType: o.kind === "source" ? "application/gzip" : "application/octet-stream",
      });
      uploads.push({ kind: o.kind, sha256: o.sha256, size: o.size, method: "PUT", ...signed });
    }
    for (const f of siteUploads) {
      const cacheControl = siteCacheControl(f.immutable);
      const signed = await deps.signer.uploadUrl({
        bucket: "sites",
        key: siteKey(site.slug, f.path),
        sha256: f.sha256,
        size: f.size,
        contentType: f.contentType,
        ...(cacheControl ? { cacheControl } : {}),
      });
      uploads.push({
        kind: "site",
        sha256: f.sha256,
        size: f.size,
        path: f.path,
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
      uploads,
    });
  });

// ---------------------------------------------------------------------------
// Complete

const ENTRY_CONTENT_TYPES: Record<string, string> = {
  "preview.html": "text/html; charset=utf-8",
  "canvas.json": "application/json; charset=utf-8",
  "index.html": "text/html; charset=utf-8",
};

const conflict = () =>
  apiError(409, "PUBLISH_CONFLICT", "The site was published from somewhere else meanwhile");
const inProgress = () =>
  apiError(409, "PUBLISH_IN_PROGRESS", "Another publish of this site is finishing. Try again.");
const publishExpired = () =>
  apiError(410, "PUBLISH_EXPIRED", "This publish expired. Publish again.");
const uploadIncomplete = (missing: { kind: string; sha256: string; path?: string }[]) =>
  apiError(409, "UPLOAD_INCOMPLETE", "Some uploads did not arrive", {
    missing: missing.slice(0, 50),
  });

const loadOwnSession = async (
  deps: PublishDeps,
  userId: string,
  sessionId: string,
): Promise<Result<SessionRow, ApiError>> => {
  const session = await deps.store.getSession(sessionId);
  return session && session.userId === userId ? ok(session) : err(notFound());
};

// The paths this plan's live entries may refer to, added to what the site
// already protects. "*" once the union gets too big to store (GC then skips
// the site until a complete replaces it): over MAX_PROTECTED_JSON_BYTES, or
// too big to share the site row with `liveFiles` under D1's row limit.
export const unionProtected = (
  current: string | null,
  paths: string[],
  liveFiles: string | null = null,
): string => {
  if (current === "*") return "*";
  let existing: string[] = [];
  if (current) {
    try {
      existing = JSON.parse(current) as string[];
    } catch {
      return "*";
    }
  }
  const json = JSON.stringify([...new Set([...existing, ...paths])].sort());
  const budget = Math.min(
    MAX_PROTECTED_JSON_BYTES,
    MAX_SITE_ROW_PATHS_BYTES - utf8Bytes(liveFiles ?? ""),
  );
  return utf8Bytes(json) > budget ? "*" : json;
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

// Every account object the session references, whatever its verified flag,
// and every plan site file.
const findMissing = async (
  deps: PublishDeps,
  session: SessionRow,
  site: SiteRow,
  plan: StoredPlan,
) => {
  const objects = planObjects(plan);
  const rows = new Map<string, StoredObjectRow>();
  for (const row of await deps.store.getStoredObjects(session.userId, objects)) {
    rows.set(refKey(row), row);
  }
  const missing: { kind: ObjectKind | "site"; sha256: string; path?: string }[] = [];
  const objectChecks = await mapLimit(objects, HEAD_CONCURRENCY, async (o) => {
    const row = rows.get(refKey(o));
    if (!row || row.deleting || row.size !== o.size) return false;
    const info = await deps.sources.head(objectKey(session.userId, o));
    return info !== null && info.size === o.size && info.sha256 === o.sha256;
  });
  objects.forEach((o, i) => {
    if (!objectChecks[i]) missing.push({ kind: o.kind, sha256: o.sha256 });
  });

  const listed = await listByKey(deps.sites, `${site.slug}/`);
  for (const f of plan.site.files) {
    const info = listed.get(siteKey(site.slug, f.path));
    if (!info || info.size !== f.size || info.sha256 !== f.sha256) {
      missing.push({ kind: "site", sha256: f.sha256, path: f.path });
    }
  }
  return missing;
};

// The answer for a session that has committed: complete is idempotent.
const completedResult = async (
  deps: PublishDeps,
  session: SessionRow,
): Promise<Result<CompletePublishResponse, ApiError> | null> => {
  if (session.status !== "completed" || session.resultVersion === null) return null;
  const site = await deps.store.findSiteById(session.siteId);
  if (!site) return err(notFound());
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

// Steps 4-7 of complete, under the lock `claimLock` took. Every way out that
// does not commit releases the lock, a throw included (run() turns that into
// a 500), so a failed complete never leaves the site locked.
const verifyAndCommit = async (
  deps: PublishDeps,
  session: SessionRow,
  site: SiteRow,
  plan: StoredPlan,
  entries: Map<string, Uint8Array>,
): Promise<Result<void, ApiError>> => {
  const release = () => deps.store.releaseCompleteLock(site.id, session.id);
  try {
    const missing = await findMissing(deps, session, site, plan);
    if (missing.length > 0) {
      await release();
      return err(uploadIncomplete(missing));
    }

    // From here the live entries may refer to this plan's paths, so they are
    // protected from GC until a commit replaces them. Only now, once every
    // upload is verified: a complete that fails before this point wrote
    // nothing, and must not grow what GC has to keep.
    //
    // Fence: in the same statement, a stale complete must not write entries
    // after its lock lapsed, or it could interleave with GC or a newer
    // complete.
    const paths = planSitePaths(plan);
    const protectedFiles = unionProtected(site.protectedFiles, paths, site.liveFiles);
    const fenced = await deps.store.setProtectedFiles({
      siteId: site.id,
      lock: session.id,
      protectedFiles,
      seenProtected: site.protectedFiles,
      fence: { now: deps.now().getTime(), minRemainingMs: COMPLETE_FENCE_MS },
    });
    if (!fenced) {
      await release();
      return err(inProgress());
    }
    for (const path of ENTRY_PATHS) {
      const bytes = entries.get(path)!;
      try {
        await deps.sites.put(siteKey(site.slug, path), bytes, {
          size: bytes.length,
          sha256: plan.site.entries.find((e) => e.path === path)!.sha256,
          contentType: ENTRY_CONTENT_TYPES[path],
        });
      } catch (error) {
        console.error(error);
        await release();
        return err(apiError(500, "STORAGE_FAILED", "Could not write the site's pages"));
      }
    }

    const now = deps.now().getTime();
    const blobs = planObjects(plan).filter((o) => o.kind === "blob");
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
      siteBytes:
        plan.site.files.reduce((a, f) => a + f.size, 0) +
        plan.site.entries.reduce((a, e) => a + e.size, 0),
      largeFiles: plan.largeFiles.map(({ path, sha256, size, mode }) => ({
        path,
        sha256,
        size,
        mode,
      })),
      liveFiles: JSON.stringify([...paths].sort()),
      liveEntries: JSON.stringify(plan.site.entries.map(({ path, sha256 }) => ({ path, sha256 }))),
      keepVersions: KEEP_VERSIONS,
      cleanupAfter: now + SITE_CLEANUP_DELAY_MS,
      now,
    });
    if (committed.ok) return ok(undefined);

    // Every entry is this plan's now, so the live pages refer to this plan's
    // paths only: what earlier failed completes protected is no longer
    // needed (this is also what clears a "*"). Only while the lock is still
    // ours, i.e. nobody has written entries since.
    await deps.store.setProtectedFiles({
      siteId: site.id,
      lock: session.id,
      protectedFiles: unionProtected(null, paths, site.liveFiles),
      seenProtected: protectedFiles,
    });
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
  req: CompletePublishRequest,
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

    // Entries: exactly the three, each matching the plan byte for byte.
    if (new Set(req.entries.map((e) => e.path)).size !== ENTRY_PATHS.length) {
      return err(invalidRequest("entries must be preview.html, canvas.json and index.html"));
    }
    const entries = new Map<string, Uint8Array>();
    for (const planned of plan.site.entries) {
      const sent = req.entries.find((e) => e.path === planned.path);
      const bytes = sent ? decodeBase64(sent.contentBase64) : null;
      if (!bytes || bytes.length !== planned.size || (await sha256Of(bytes)) !== planned.sha256) {
        return err(
          apiError(422, "ENTRY_MISMATCH", `${planned.path} does not match the publish plan`, {
            path: planned.path,
          }),
        );
      }
      entries.set(planned.path, bytes);
    }

    // Verification costs up to ~500 R2 HEADs and a listing of the site.
    const { success } = await deps.completeLimiter.limit({ key: userId });
    if (!success) {
      return err(apiError(429, "RATE_LIMITED", "Too many publish attempts. Try again in a minute."));
    }

    const locked = await claimLock(deps, session);
    if (locked.isErr()) {
      return locked.error.code === "PUBLISH_CONFLICT"
        ? conflictOrCompleted(deps, session.id)
        : err(locked.error);
    }
    const site = locked.value;
    const committed = await verifyAndCommit(deps, session, site, plan, entries);
    if (committed.isErr()) return err(committed.error);

    const updated = await deps.store.findSiteById(site.id);
    if (!updated) return err(notFound());
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
    const site = await deps.store.findSiteById(session.siteId);
    if (!site) return err(notFound());
    // GC marks lapsed sessions expired hourly; report it straight away.
    const status =
      session.status === "pending" && session.expiresAt < deps.now().getTime()
        ? "expired"
        : session.status;
    return ok({
      status,
      resultVersion: session.resultVersion,
      site: await siteStatusOf(deps, site),
    });
  });

// Upload URLs already handed out stay usable until they expire and cannot be
// revoked, so an abort keeps the session's hold: its objects stay safe from
// GC, its paths protected and its site bytes counted until then. A session
// that was never given any URL has nothing in flight, and its hold ends at
// once (spec §10, Q9). A site URL counts: its bytes land on live keys.
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
    await deps.store.setSessionStatus(session.id, "aborted", {
      onlyIfPending: true,
      ...(releaseHold ? { holdUntil: Math.min(session.holdUntil, deps.now().getTime()) } : {}),
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

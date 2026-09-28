import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { CommitResult, SiteStore } from "@antidraw/site-upload/server";
import { err, ok, type Result } from "neverthrow";
import type { Db } from "../db";
import { publish, site } from "../db/schema";
import { apiError, type ApiError } from "../lib/errors";
import { slugCandidates } from "../lib/slug";

// How long a publish may run before it's abandoned. SiteStore's plan TTL
// (default 1 h) is the real limit; this matches it, so the lock is never
// held for a plan that can no longer commit.
export const PUBLISH_TTL_MS = 60 * 60 * 1000;
// SiteStore's orphan grace period (default 1 h): files younger than this are
// kept, so cleaning up sooner after an abandoned publish would find nothing.
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
// How long a scheduled cleanup holds a site before another may try again.
const CLEANUP_HOLD_MS = 10 * 60 * 1000;

export type CreatedSite = { id: string; slug: string; url: string };

const notFound = (what: string) => apiError(404, "NOT_FOUND", `No such ${what}`);

export const siteUrl = (pattern: string, slug: string) => pattern.replace("*", slug);

export const createSite = async (
  db: Db,
  ownerId: string,
  title: string,
  urlPattern: string,
): Promise<Result<CreatedSite, ApiError>> => {
  // Never reused, and the key for the site's files in R2 (see models/site.model.ts).
  const id = crypto.randomUUID();
  for (const slug of slugCandidates(title)) {
    const [row] = await db
      .insert(site)
      .values({ id, ownerId, slug, title })
      .onConflictDoNothing({ target: site.slug })
      .returning({ id: site.id });
    if (row) return ok({ id, slug, url: siteUrl(urlPattern, slug) });
  }
  // Only after several random suffixes all collided.
  return err(apiError(503, "SLUG_UNAVAILABLE", "Couldn't find a free name for the site; try again"));
};

/**
 * Starts a publish: takes the site's lock for a new publish id, replacing any
 * publish still running. The replaced one's next request is refused, so its
 * plan, uploads and commit stop overlapping this one's (the library's orphan
 * grace period covers a request of it already under way).
 */
export const startPublish = async (
  db: Db,
  siteId: string,
  ownerId: string,
  now: number,
): Promise<Result<{ publishId: string }, ApiError>> => {
  const publishId = crypto.randomUUID();
  const [locked] = await db
    .update(site)
    .set({ lockPublishId: publishId, lockUntil: new Date(now + PUBLISH_TTL_MS) })
    .where(and(eq(site.id, siteId), eq(site.ownerId, ownerId)))
    .returning({ id: site.id });
  if (!locked) return err(notFound("site"));
  await db.insert(publish).values({ id: publishId, siteId, status: "open" });
  return ok({ publishId });
};

/** What an upload request may do: go ahead, or answer a retried commit from the record. */
export type UploadAccess = { kind: "upload" } | { kind: "committed"; result: CommitResult };

/** Whether this user may send requests for this publish now. */
export const checkUpload = async (
  db: Db,
  siteId: string,
  publishId: string,
  ownerId: string,
  now: number,
): Promise<Result<UploadAccess, ApiError>> => {
  const [row] = await db
    .select({ lockPublishId: site.lockPublishId, lockUntil: site.lockUntil })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.ownerId, ownerId)));
  if (!row) return err(notFound("site"));

  if (row.lockPublishId === publishId) {
    if (row.lockUntil && row.lockUntil.getTime() <= now) {
      return err(apiError(410, "PLAN_EXPIRED", "This publish ran out of time; start a new one"));
    }
    return ok({ kind: "upload" });
  }

  // Not the running publish: one that already went live (a commit retried
  // after its lock was released), one that was replaced, or none at all.
  const [record] = await db
    .select({ status: publish.status, previous: publish.previous })
    .from(publish)
    .where(and(eq(publish.id, publishId), eq(publish.siteId, siteId)));
  if (!record) return err(notFound("publish"));
  if (record.status === "live") {
    return ok({
      kind: "committed",
      result: { publishId, previous: record.previous, alreadyCommitted: true },
    });
  }
  return err(apiError(409, "SUPERSEDED", "A newer publish of this site replaced this one"));
};

/** Records a commit and releases the site's lock, unless another publish has taken it since. */
export const finishPublish = async (
  db: Db,
  siteId: string,
  result: CommitResult,
  now: number,
) => {
  await db.batch([
    db
      .update(publish)
      .set({ status: "live", previous: result.previous, committedAt: new Date(now) })
      .where(eq(publish.id, result.publishId)),
    db
      .update(site)
      .set({ lockPublishId: null, lockUntil: null })
      .where(and(eq(site.id, siteId), eq(site.lockPublishId, result.publishId))),
  ]);
};

/**
 * Cleans up sites whose last publish was abandoned (started, never committed)
 * long enough ago that its files are past the orphan grace period. Each site
 * is claimed with a compare-and-set on its lock first, so a publish started
 * meanwhile keeps the site, and one started during the cleanup takes it over.
 * Runs from the cron trigger; returns the sites it cleaned.
 */
export const cleanUpAbandoned = async (
  db: Db,
  store: SiteStore,
  now: number,
  limit = 25,
): Promise<string[]> => {
  const rows = await db
    .select({ id: site.id, lockPublishId: site.lockPublishId })
    .from(site)
    .where(and(isNotNull(site.lockPublishId), lt(site.lockUntil, new Date(now - ORPHAN_GRACE_MS))))
    .limit(limit);
  const cleaned: string[] = [];
  for (const row of rows) {
    const claim = `cleanup-${crypto.randomUUID()}`;
    const [won] = await db
      .update(site)
      .set({ lockPublishId: claim, lockUntil: new Date(now + CLEANUP_HOLD_MS) })
      .where(and(eq(site.id, row.id), eq(site.lockPublishId, row.lockPublishId!)))
      .returning({ id: site.id });
    if (!won) continue;
    try {
      await store.cleanup(row.id);
    } catch (error) {
      // The claim lapses and a later run tries again.
      console.error(error);
      continue;
    }
    await db
      .update(site)
      .set({ lockPublishId: null, lockUntil: null })
      .where(and(eq(site.id, row.id), eq(site.lockPublishId, claim)));
    cleaned.push(row.id);
  }
  return cleaned;
};

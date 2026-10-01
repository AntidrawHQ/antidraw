import { and, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
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
// kept, so cleaning up sooner after a publish would find nothing to delete.
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
// Extra time for a request still under way when its publish's lock ran out.
const STRAGGLER_MS = 5 * 60 * 1000;
// How long a plan or commit keeps its site busy if it never clears it (its
// Worker died): the longest a new publish of the site then waits.
const REQUEST_HOLD_MS = 60 * 1000;
// How long a scheduled cleanup holds a site if it never releases it (its
// Worker died); it releases it as soon as it finishes or fails.
const CLEANUP_HOLD_MS = 10 * 60 * 1000;

// url is the site's share page, the address to give out; its files are
// served from <slug>.antidraw.app, which the share page reads.
export type CreatedSite = { id: string; slug: string; url: string };

const notFound = (what: string) => apiError(404, "NOT_FOUND", `No such ${what}`);

export const shareUrl = (pattern: string, slug: string) => pattern.replace("*", slug);

// No plan, commit or cleanup of the site is running (or one's hold lapsed).
const notBusy = (now: number) => or(isNull(site.busyUntil), lte(site.busyUntil, new Date(now)));

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
    if (row) return ok({ id, slug, url: shareUrl(urlPattern, slug) });
  }
  // Only after several random suffixes all collided.
  return err(apiError(503, "SLUG_UNAVAILABLE", "Couldn't find a free name for the site; try again"));
};

/**
 * Starts a publish: takes the site's lock for a new publish id, replacing any
 * publish still running. The replaced one is marked superseded and its next
 * request is refused, so its plan, uploads and commit stop overlapping this
 * one's (the library's orphan grace period covers an upload of it already
 * under way). Refused with SITE_BUSY while a plan, commit or cleanup of the
 * site is running: those clean up, and a cleanup must not overlap another
 * publish.
 */
export const startPublish = async (
  db: Db,
  siteId: string,
  ownerId: string,
  now: number,
): Promise<Result<{ publishId: string }, ApiError>> => {
  const publishId = crypto.randomUUID();
  const lockUntil = now + PUBLISH_TTL_MS;
  const tookLock = sql`exists (select 1 from ${site} where ${site.id} = ${siteId} and ${site.lockPublishId} = ${publishId})`;
  // One transaction, so two starts at once can't interleave: the one whose
  // lock stands is the one that superseded the other.
  const [[locked]] = await db.batch([
    db
      .update(site)
      .set({
        lockPublishId: publishId,
        lockUntil: new Date(lockUntil),
        busyUntil: null,
        // Whatever this publish and the ones before it leave is in a plan made
        // before lockUntil or a file uploaded before it, so a cleanup then (plus
        // the plan TTL or grace period) can clear all of it.
        cleanupAfter: new Date(lockUntil + Math.max(PUBLISH_TTL_MS, ORPHAN_GRACE_MS) + STRAGGLER_MS),
      })
      .where(and(eq(site.id, siteId), eq(site.ownerId, ownerId), notBusy(now)))
      .returning({ id: site.id }),
    // Only if the lock was taken: the publishes it replaces, then its record.
    db
      .update(publish)
      .set({ status: "superseded" })
      .where(and(eq(publish.siteId, siteId), eq(publish.status, "open"), tookLock)),
    // Every column, in the table's order: id, site_id, status, previous, created_at, committed_at.
    db
      .insert(publish)
      .select(
        sql`select ${publishId}, ${siteId}, 'open', null, cast(unixepoch('subsecond') * 1000 as integer), null where ${tookLock}`,
      ),
  ]);
  if (!locked) {
    const [row] = await db
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.id, siteId), eq(site.ownerId, ownerId)));
    if (!row) return err(notFound("site"));
    // The hold normally clears within seconds, so ask for a quick retry
    // rather than the hold's full length.
    return err({
      ...apiError(409, "SITE_BUSY", "This site is finishing a publish or a cleanup; try again in a moment"),
      retryAfter: 2,
    });
  }
  return ok({ publishId });
};

/** What an upload request may do: go ahead, or answer a retried commit from the record. */
export type UploadAccess = { kind: "upload" } | { kind: "committed"; result: CommitResult };

/**
 * Whether this user may send requests for this publish now. With `hold`, for
 * requests that clean up (a plan or a commit), a go-ahead also keeps the site
 * busy until releaseUpload() or finishPublish().
 */
export const checkUpload = async (
  db: Db,
  store: SiteStore,
  siteId: string,
  publishId: string,
  ownerId: string,
  now: number,
  { hold }: { hold: boolean },
): Promise<Result<UploadAccess, ApiError>> => {
  if (hold) {
    const [held] = await db
      .update(site)
      .set({ busyUntil: new Date(now + REQUEST_HOLD_MS) })
      .where(
        and(
          eq(site.id, siteId),
          eq(site.ownerId, ownerId),
          eq(site.lockPublishId, publishId),
          gt(site.lockUntil, new Date(now)),
        ),
      )
      .returning({ id: site.id });
    if (held) return ok({ kind: "upload" });
  }

  const [row] = await db
    .select({ lockPublishId: site.lockPublishId, lockUntil: site.lockUntil })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.ownerId, ownerId)));
  if (!row) return err(notFound("site"));
  const holdsLock = row.lockPublishId === publishId;
  if (holdsLock && !hold && row.lockUntil && row.lockUntil.getTime() > now) {
    return ok({ kind: "upload" });
  }

  // Not the running publish: one that already went live (a commit retried
  // after its lock was released), one that ran out of time or was replaced,
  // or none at all.
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

  // Not recorded live, but its commit may have gone live anyway (the Worker
  // stopped before finishPublish): the pointer knows.
  const pointer = await store.readPointer(siteId);
  if (pointer?.publishId === publishId) {
    const result = { publishId, previous: pointer.previous, alreadyCommitted: true };
    await finishPublish(db, siteId, result, pointer.committedAt);
    return ok({ kind: "committed", result });
  }

  if (record.status === "superseded") {
    return err(apiError(409, "SUPERSEDED", "A newer publish of this site replaced this one"));
  }
  return err(apiError(410, "PLAN_EXPIRED", "This publish ran out of time; start a new one"));
};

/** Ends a request's hold on its site (see checkUpload), if its publish still holds the lock. */
export const releaseUpload = async (db: Db, siteId: string, publishId: string) => {
  await db
    .update(site)
    .set({ busyUntil: null })
    .where(and(eq(site.id, siteId), eq(site.lockPublishId, publishId)));
};

/** Records a commit and releases the site's lock, unless another publish has taken it since. */
export const finishPublish = async (
  db: Db,
  siteId: string,
  result: CommitResult,
  committedAt: number,
) => {
  await db.batch([
    db
      .update(publish)
      .set({ status: "live", previous: result.previous, committedAt: new Date(committedAt) })
      .where(and(eq(publish.id, result.publishId), ne(publish.status, "live"))),
    db
      .update(site)
      .set({ lockPublishId: null, lockUntil: null, busyUntil: null })
      .where(and(eq(site.id, siteId), eq(site.lockPublishId, result.publishId))),
  ]);
};

export type CleanUpOptions = {
  /** Sites read per query. */
  batch?: number;
  /** At most this many sites per run, well inside a Worker's 10,000 subrequests. */
  maxSites?: number;
  /** Stop starting new sites after this long (a cron trigger may run 15 min). */
  budgetMs?: number;
  clock?: () => number;
};

/**
 * Clears what publishes left behind (uploads never committed, files the live
 * version dropped) on every site past its cleanup_after, a batch at a time,
 * until none are left or the run's limits are reached. Each site is claimed
 * first (a `cleanup-` lock that keeps the site busy), so no publish can start
 * while it's cleaned; a publish started before the claim moved cleanup_after
 * on, and keeps the site. A commit that went live without being recorded is
 * recorded here too. Runs from the cron trigger; returns the sites it cleaned.
 */
export const cleanUpLeftovers = async (
  db: Db,
  store: SiteStore,
  { batch = 25, maxSites = 500, budgetMs = 10 * 60 * 1000, clock = Date.now }: CleanUpOptions = {},
): Promise<string[]> => {
  const start = clock();
  const cleaned: string[] = [];
  let tried = 0;
  let after: { cleanupAfter: Date; id: string } | undefined;
  for (;;) {
    const rows = await db
      .select({ id: site.id, cleanupAfter: site.cleanupAfter })
      .from(site)
      .where(
        and(
          lte(site.cleanupAfter, new Date(start)),
          notBusy(start),
          after &&
            or(
              gt(site.cleanupAfter, after.cleanupAfter),
              and(eq(site.cleanupAfter, after.cleanupAfter), gt(site.id, after.id)),
            ),
        ),
      )
      .orderBy(site.cleanupAfter, site.id)
      .limit(batch);

    for (const row of rows) {
      if (tried >= maxSites || clock() - start >= budgetMs) {
        console.warn(`Cleanup stopped after ${tried} sites; the next run continues`);
        return cleaned;
      }
      tried++;
      const now = clock();
      const claim = `cleanup-${crypto.randomUUID()}`;
      const [won] = await db
        .update(site)
        .set({ lockPublishId: claim, lockUntil: null, busyUntil: new Date(now + CLEANUP_HOLD_MS) })
        .where(and(eq(site.id, row.id), eq(site.cleanupAfter, row.cleanupAfter!), notBusy(now)))
        .returning({ id: site.id });
      if (!won) continue;
      let done = true;
      try {
        const pointer = await store.readPointer(row.id);
        if (pointer) {
          const result = { publishId: pointer.publishId, previous: pointer.previous, alreadyCommitted: true };
          await finishPublish(db, row.id, result, pointer.committedAt);
        }
        await store.cleanup(row.id);
      } catch (error) {
        // Nothing runs any more, so publishes may start again; cleanup_after
        // stays past, so the next run tries the site again.
        console.error(error);
        done = false;
      }
      try {
        await db
          .update(site)
          .set({ lockPublishId: null, lockUntil: null, busyUntil: null, ...(done && { cleanupAfter: null }) })
          .where(and(eq(site.id, row.id), eq(site.lockPublishId, claim)));
      } catch (error) {
        // The claim lapses after CLEANUP_HOLD_MS; carry on with the other sites.
        console.error(error);
        continue;
      }
      if (done) cleaned.push(row.id);
    }

    if (rows.length < batch) return cleaned;
    const last = rows[rows.length - 1]!;
    after = { cleanupAfter: last.cleanupAfter!, id: last.id };
  }
};

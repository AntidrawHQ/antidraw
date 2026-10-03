import { SiteUploadError, type CommitResult } from "@antidraw/site-upload/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Db } from "../db";
import { publish, site } from "../db/schema";
import { apiError, type ApiError } from "../lib/errors";
import { slugCandidates } from "../lib/slug";

// url is the site's share page, the address to give out; its files are
// served from <slug>.antidraw.app, which the share page reads.
export type CreatedSite = { id: string; slug: string; url: string };

export const shareUrl = (pattern: string, slug: string) => pattern.replace("*", slug);

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

export const ownsSite = async (db: Db, siteId: string, ownerId: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.ownerId, ownerId)));
  return row !== undefined;
};

/** Starts a publish on top of the site's current version (its seq now). */
export const startPublish = async (db: Db, siteId: string): Promise<string> => {
  const publishId = crypto.randomUUID();
  // base_seq is read in the same statement, so it's the seq at this instant.
  await db.insert(publish).values({
    id: publishId,
    siteId,
    baseSeq: sql`(select ${site.seq} from ${site} where ${site.id} = ${siteId})`,
  });
  return publishId;
};

/**
 * Makes a publish live, once @antidraw/site-upload has checked its files are
 * all stored: only if nothing went live since it started. Throws the
 * library's errors, which handleUpload answers with.
 */
export const commitPublish = async (
  db: Db,
  siteId: string,
  publishId: string,
  now: number,
): Promise<CommitResult> => {
  const baseSeq = sql`(select ${publish.baseSeq} from ${publish} where ${publish.id} = ${publishId} and ${publish.siteId} = ${siteId})`;
  // One transaction: the switch, and the publish's record if it went live.
  const [[switched]] = await db.batch([
    db
      .update(site)
      // SQLite reads every right-hand side from the row as it was, so
      // previous becomes the publish that was live until now.
      .set({ previousPublishId: sql`${site.livePublishId}`, livePublishId: publishId, seq: sql`${site.seq} + 1` })
      .where(and(eq(site.id, siteId), eq(site.seq, baseSeq)))
      .returning({ previous: site.previousPublishId }),
    db
      .update(publish)
      .set({ committedAt: new Date(now) })
      .where(
        and(
          eq(publish.id, publishId),
          isNull(publish.committedAt),
          sql`exists (select 1 from ${site} where ${site.id} = ${siteId} and ${site.livePublishId} = ${publishId})`,
        ),
      ),
  ]);
  if (switched) return { publishId, previous: switched.previous, alreadyCommitted: false };

  // A retry of a commit that went through (its answer was lost), or too late.
  const [row] = await db
    .select({ live: site.livePublishId, previous: site.previousPublishId })
    .from(site)
    .where(eq(site.id, siteId));
  if (row?.live === publishId) return { publishId, previous: row.previous, alreadyCommitted: true };
  const [started] = await db
    .select({ id: publish.id })
    .from(publish)
    .where(and(eq(publish.id, publishId), eq(publish.siteId, siteId)));
  if (!started) throw new SiteUploadError("NOT_FOUND", `No publish ${publishId} was started for this site`);
  throw new SiteUploadError("SUPERSEDED", `Publish ${row?.live} went live after ${publishId} started`, {
    live: row?.live ?? null,
  });
};

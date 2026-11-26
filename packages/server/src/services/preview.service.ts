import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { site } from "../db/schema";
import type { Bindings } from "../lib/env";
import { siteStore } from "../lib/site-store";

// A published site's preview image: a picture of its canvas, for links to its
// share page (og:image) and the app's dashboard. Taken with Browser Run when
// a publish goes live, of the share page's own picture view (?shot, see
// @antidraw/share-page's shot.ts), and stored beside the publish
// (SiteStore.putPreview). @antidraw/site-worker serves the live one at
// <slug>.antidraw.app/og.jpg.
//
// Nothing outside reaches this: the commit route asks for a picture by
// queueing a message (requestPreview), and the Worker's queue handler takes
// it (takePreview). The address photographed is built here from the site's
// slug, never taken from a request.

export type PreviewMessage = { siteId: string; publishId: string };

// The picture's size: what link previews are shown at, twice over for sharp
// screens.
const VIEWPORT = { width: 1200, height: 630, deviceScaleFactor: 2 };
// The share page marks itself when its frames have rendered, and by 20 s
// however that's going; the rest is for the page to load.
const READY = { selector: "[data-frames-ready]", timeout: 45_000 };
// How long after the commit the picture is taken (PREVIEW_DELAY_SECONDS): the
// site Worker asks which publish is live at most every 5 s, so sooner than
// that the page could still show the last one.
const delaySeconds = (env: Bindings) => Number(env.PREVIEW_DELAY_SECONDS) || 0;

/** How long a picture that couldn't be taken waits for try number `attempts` + 1: twice as long each time. */
export const retryDelaySeconds = (env: Bindings, attempts: number) => delaySeconds(env) * 2 ** attempts;
// A picture is tens to hundreds of KB. More is not one.
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Asks for a picture of a publish that went live. Never throws: a site
 * without a picture is still published, and the next publish asks again.
 */
export const requestPreview = async (env: Bindings, message: PreviewMessage) => {
  try {
    await env.PREVIEWS.send(message, { delaySeconds: delaySeconds(env) });
  } catch (error) {
    console.error(`Couldn't ask for a preview of ${message.siteId}/${message.publishId}:`, error);
  }
};

const liveSite = async (db: Db, siteId: string) => {
  const [row] = await db.select({ slug: site.slug, live: site.livePublishId }).from(site).where(eq(site.id, siteId));
  return row;
};

/**
 * Takes the picture a message asked for and stores it. "skipped" when the
 * publish isn't the live one any more (the one that is has a message of its
 * own) or already has its picture. Throws when the picture couldn't be
 * taken, for the queue to try again.
 */
export const takePreview = async (env: Bindings, db: Db, { siteId, publishId }: PreviewMessage) => {
  const before = await liveSite(db, siteId);
  if (!before || before.live !== publishId) return "skipped";
  const store = siteStore(env);
  // A commit retried by the app asks twice.
  if (await store.getPreview(siteId, publishId)) return "skipped";

  const url = new URL(env.SHARE_URL_PATTERN.replace("*", before.slug));
  url.searchParams.set("shot", "1");
  const shot = await env.BROWSER.quickAction("screenshot", {
    url: url.href,
    viewport: VIEWPORT,
    gotoOptions: { waitUntil: "load", timeout: 30_000 },
    waitForSelector: READY,
    screenshotOptions: { type: "jpeg", quality: 85 },
  });
  if (!shot.ok || !shot.headers.get("content-type")?.startsWith("image/jpeg")) {
    throw new Error(`Browser Run answered ${shot.status}: ${(await shot.text()).slice(0, 300)}`);
  }
  const image = await shot.arrayBuffer();
  if (image.byteLength === 0 || image.byteLength > MAX_BYTES) {
    throw new Error(`Browser Run sent a picture of ${image.byteLength} bytes`);
  }

  // The page shows whatever is live: if another publish went live meanwhile,
  // this may be a picture of that one, which gets its own.
  const after = await liveSite(db, siteId);
  if (after?.live !== publishId) return "skipped";
  await store.putPreview(siteId, publishId, image);
  return "stored";
};

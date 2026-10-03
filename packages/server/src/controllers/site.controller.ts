import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { handleUpload, type CommitResult } from "@antidraw/site-upload/server";
import { z } from "zod";
import { getDb } from "../db";
import { requireBearer, type AuthedEnv } from "../lib/require-session";
import { respond, respondError } from "../lib/respond";
import { siteStore } from "../lib/site-store";
import {
  checkUpload,
  createSite,
  finishPublish,
  releaseUpload,
  startPublish,
} from "../services/site.service";

// Publishing a site (see @antidraw/site-upload for the upload protocol):
//
//   POST /api/sites                          { title } -> { id, slug, url }  (url: the share page)
//   POST /api/sites/:id/publishes            -> { publishId, uploadUrl }  (409 SITE_BUSY: retry)
//   POST /api/sites/:id/publishes/:pid/plan          manifest -> { missing }
//   PUT  /api/sites/:id/publishes/:pid/files/:sha256 bytes -> { ok }
//   POST /api/sites/:id/publishes/:pid/commit        -> { publishId, previous, alreadyCommitted }
//
// The last three are the library's handleUpload, reached only by the site's
// owner and only for the publish holding the site's lock. uploadUrl is what
// the client's createHttpTransport takes as its baseUrl. Starting a publish
// answers 409 SITE_BUSY (with retry-after) for the moment a plan, commit or
// cleanup of the site is running; the client retries it.
export const siteController = new Hono<AuthedEnv>();

siteController.use(requireBearer);

const createBody = z.object({ title: z.string().trim().min(1).max(200) });

siteController.post(
  "/",
  zValidator("json", createBody, (result, ctx) => {
    if (!result.success) {
      return respondError(ctx, 400, "INVALID_REQUEST", "Body must be { title: string }");
    }
  }),
  async (ctx) => {
    const { title } = ctx.req.valid("json");
    const db = getDb(ctx.env);
    return respond(
      ctx,
      await createSite(db, ctx.get("user").id, title, ctx.env.SHARE_URL_PATTERN),
      201,
    );
  },
);

siteController.post("/:siteId/publishes", async (ctx) => {
  const siteId = ctx.req.param("siteId");
  const started = await startPublish(getDb(ctx.env), siteId, ctx.get("user").id, Date.now());
  return respond(
    ctx,
    started.map(({ publishId }) => ({
      publishId,
      uploadUrl: new URL(`${ctx.req.path}/${publishId}`, ctx.req.url).href,
    })),
    201,
  );
});

siteController.on(["POST", "PUT"], "/:siteId/publishes/:publishId/:path{.+}", async (ctx) => {
  const { siteId, publishId, path } = ctx.req.param();
  const db = getDb(ctx.env);
  const store = siteStore(ctx.env);
  // A plan and a commit clean up (the library's plan() runs cleanup() too), so
  // they keep the site busy while they run: no new publish starts under them.
  const hold = path === "plan" || path === "commit";
  const access = await checkUpload(db, store, siteId, publishId, ctx.get("user").id, Date.now(), { hold });
  if (access.isErr()) return respond(ctx, access);
  if (access.value.kind === "committed") {
    // A commit retried after it went live gets the same answer; anything else is too late.
    if (path === "commit") return ctx.json(access.value.result);
    return respondError(ctx, 409, "CONFLICT", "This publish is already live");
  }

  try {
    const response = await handleUpload(store, ctx.req.raw, { site: siteId, publishId, path });
    if (path === "commit" && response.ok) {
      const result: CommitResult = await response.clone().json();
      // Still under the lock and the hold, as the library requires. The commit
      // has already succeeded, so a failed cleanup only leaves files for the
      // scheduled one.
      try {
        await store.cleanup(siteId);
      } catch (error) {
        console.error(error);
      }
      await finishPublish(db, siteId, result, Date.now());
    }
    return response;
  } finally {
    // After finishPublish the lock is released and this does nothing.
    if (hold) await releaseUpload(db, siteId, publishId);
  }
});

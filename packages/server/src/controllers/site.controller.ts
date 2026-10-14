import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { handleUpload } from "@antidraw/site-upload/server";
import { z } from "zod";
import { getDb } from "../db";
import { requireBearer, type AuthedEnv } from "../lib/require-session";
import { respond, respondError } from "../lib/respond";
import { siteStore } from "../lib/site-store";
import { commitPublish, createSite, ownsSite, startPublish } from "../services/site.service";
import { endSourcePush, hasSourceCommit, sourceAccess } from "../services/source.service";

// Publishing a site (see @antidraw/site-upload for the upload protocol):
//
//   POST /api/sites                          { title } -> { id, slug, url }  (url: the share page)
//   POST /api/sites/:id/source               -> { remote, token, expiresAt }  (pushing the source)
//   POST /api/sites/:id/publishes            { commit } -> { publishId, uploadUrl }
//   POST /api/sites/:id/publishes/:pid/plan          manifest -> { missing }
//   PUT  /api/sites/:id/publishes/:pid/files/:sha256 bytes -> { ok }
//   POST /api/sites/:id/publishes/:pid/commit        -> { publishId, previous, alreadyCommitted }
//
// The last three are the library's handleUpload, reached only by the site's
// owner. uploadUrl is what the client's createHttpTransport takes as its
// baseUrl. The app pushes the workspace's source to the site's git repo
// first (services/source.service.ts) and names the commit when it starts the
// publish. Publishes of a site may overlap: the first to commit goes live, and
// the others get SUPERSEDED (see commitPublish). Nothing is deleted while
// publishing; clearing old files is SiteStore.cleanup(), run by hand.
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

// Everything under a site is its owner's alone; to anyone else it doesn't exist.
siteController.use("/:siteId/*", async (ctx, next) => {
  if (!(await ownsSite(getDb(ctx.env), ctx.req.param("siteId"), ctx.get("user").id))) {
    return respondError(ctx, 404, "NOT_FOUND", "No such site");
  }
  await next();
});

siteController.post("/:siteId/source", async (ctx) =>
  respond(ctx, await sourceAccess(getDb(ctx.env), ctx.env.ARTIFACTS, ctx.req.param("siteId"))),
);

// Every version that goes live names the commit it was built from, so it can
// be remixed from its source.
const publishBody = z.object({ commit: z.string().regex(/^[0-9a-f]{40}$/) });

siteController.post("/:siteId/publishes", async (ctx) => {
  const body = publishBody.safeParse(await ctx.req.json().catch(() => ({})));
  if (!body.success) {
    return respondError(ctx, 400, "INVALID_REQUEST", "Body must be { commit: a 40-character commit id }");
  }
  const siteId = ctx.req.param("siteId");
  const db = getDb(ctx.env);
  const { commit } = body.data;
  const found = await hasSourceCommit(db, ctx.env.ARTIFACTS, siteId, commit);
  if (found.isErr()) return respond(ctx, found);
  if (!found.value) return respondError(ctx, 409, "SOURCE_NOT_FOUND", `The site's source has no commit ${commit}`);
  // The push is done, so its token has nothing left to do.
  await endSourcePush(ctx.env.ARTIFACTS, siteId);
  const publishId = await startPublish(db, siteId, commit);
  return ctx.json({ publishId, uploadUrl: new URL(`${ctx.req.path}/${publishId}`, ctx.req.url).href }, 201);
});

siteController.on(["POST", "PUT"], "/:siteId/publishes/:publishId/:path{.+}", (ctx) => {
  const { siteId, publishId, path } = ctx.req.param();
  const db = getDb(ctx.env);
  return handleUpload(siteStore(ctx.env), ctx.req.raw, { site: siteId, publishId, path }, {
    commit: () => commitPublish(db, siteId, publishId, Date.now()),
  });
});

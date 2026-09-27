import { Hono } from "hono";
import { remixRequest } from "../lib/publish.schemas";
import { requireSession } from "../lib/require-session";
import { respond } from "../lib/respond";
import { jsonBody } from "../lib/validate";
import { remixSite } from "../services/remix.service";
import { withPublishDeps, type PublishEnv, type PublishOptions } from "./publish.controller";

// POST /api/remix { slug } — signed download URLs for a site's head snapshot
// (spec §2.6). The client flow that uses it comes later.
export const remixController = (opts: PublishOptions = {}) => {
  const controller = new Hono<PublishEnv>();
  controller.post("/", requireSession, withPublishDeps(opts), jsonBody(remixRequest), async (ctx) =>
    respond(ctx, await remixSite(ctx.get("deps"), ctx.get("user").id, ctx.req.valid("json").slug)),
  );
  return controller;
};

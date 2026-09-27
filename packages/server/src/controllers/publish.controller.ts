import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { err, ok } from "neverthrow";
import { z } from "zod";
import type { Bindings } from "../lib/env";
import {
  beginPublishRequest,
  completePublishRequest,
  patchSiteRequest,
  siteStatusQuery,
} from "../lib/publish.schemas";
import { requireSession, type AuthedEnv } from "../lib/require-session";
import { respond, respondError } from "../lib/respond";
import { jsonBody, param, query } from "../lib/validate";
import {
  abortPublish,
  beginPublish,
  completePublish,
  getPublishSession,
  getSiteStatus,
  makePublishDeps,
  setAllowRemix,
  type PublishDeps,
} from "../services/publish.service";

// /api/publish/* — the cloud half of the Publish button (spec §2). The app's
// main process calls these with its Bearer token; the renderer never does.
//
//   POST  /sessions               begin: plan in, upload instructions out
//   POST  /sessions/:id/complete  verify uploads, switch the pages, commit
//   POST  /sessions/:id/abort     best effort, idempotent
//   GET   /sessions/:id           settle a complete whose outcome was lost
//   GET   /sites?clientWorkspaceId=
//   PATCH /sites/:siteId          { allowRemix }

export type PublishOptions = {
  // Tests pass fakes; production builds deps from the Worker's bindings.
  publishDeps?: (env: Bindings) => PublishDeps;
};

export type PublishEnv = AuthedEnv & { Variables: { deps: PublishDeps } };

// Resolves the deps once per request, failing closed (500 CONFIG_INVALID or
// STORAGE_MISCONFIGURED) on a misconfigured deploy. Runs after requireSession.
export const withPublishDeps = (opts: PublishOptions) =>
  createMiddleware<PublishEnv>(async (ctx, next) => {
    const deps = opts.publishDeps ? ok(opts.publishDeps(ctx.env)) : makePublishDeps(ctx.env);
    if (deps.isErr()) return respond(ctx, err(deps.error));
    ctx.set("deps", deps.value);
    await next();
  });

const sessionParam = param(z.object({ id: z.string().min(1).max(64) }));
const siteParam = param(z.object({ siteId: z.string().min(1).max(64) }));

// Three base64 entries of at most 2 MiB each, with room for the JSON around them.
const COMPLETE_BODY_LIMIT = 12 * 1024 * 1024;

export const publishController = (opts: PublishOptions = {}) => {
  const controller = new Hono<PublishEnv>();
  controller.use("*", requireSession, withPublishDeps(opts));

  controller.post("/sessions", jsonBody(beginPublishRequest), async (ctx) =>
    respond(ctx, await beginPublish(ctx.get("deps"), ctx.get("user").id, ctx.req.valid("json"))),
  );

  controller.post(
    "/sessions/:id/complete",
    bodyLimit({
      maxSize: COMPLETE_BODY_LIMIT,
      onError: (ctx) => respondError(ctx, 413, "PAYLOAD_TOO_LARGE", "Request body too large"),
    }),
    sessionParam,
    jsonBody(completePublishRequest),
    async (ctx) =>
      respond(
        ctx,
        await completePublish(
          ctx.get("deps"),
          ctx.get("user").id,
          ctx.req.valid("param").id,
          ctx.req.valid("json"),
        ),
      ),
  );

  controller.post("/sessions/:id/abort", sessionParam, async (ctx) =>
    respond(
      ctx,
      await abortPublish(ctx.get("deps"), ctx.get("user").id, ctx.req.valid("param").id),
    ),
  );

  controller.get("/sessions/:id", sessionParam, async (ctx) =>
    respond(
      ctx,
      await getPublishSession(ctx.get("deps"), ctx.get("user").id, ctx.req.valid("param").id),
    ),
  );

  controller.get("/sites", query(siteStatusQuery), async (ctx) =>
    respond(
      ctx,
      await getSiteStatus(
        ctx.get("deps"),
        ctx.get("user").id,
        ctx.req.valid("query").clientWorkspaceId,
      ),
    ),
  );

  controller.patch("/sites/:siteId", siteParam, jsonBody(patchSiteRequest), async (ctx) =>
    respond(
      ctx,
      await setAllowRemix(
        ctx.get("deps"),
        ctx.get("user").id,
        ctx.req.valid("param").siteId,
        ctx.req.valid("json").allowRemix,
      ),
    ),
  );

  return controller;
};

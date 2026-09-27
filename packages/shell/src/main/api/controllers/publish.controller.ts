import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  cancelPublish,
  getPublishStatus,
  publishWorkspace,
  setAllowRemix,
} from "@/main/services/publish/publish.service";
import type { PublishError } from "@/main/services/publish/types";

export const publishController = new Hono();

const workspaceIdParamSchema = z.object({
  workspaceId: z.uuid(),
});

// allowRemix is passed through as is: absent means "keep the site's setting".
// There is no default.
const publishBodySchema = z.object({
  allowRemix: z.boolean().optional(),
});

const allowRemixBodySchema = z.object({
  allowRemix: z.boolean(),
});

const errorStatus = (code: PublishError["code"]): ContentfulStatusCode => {
  switch (code) {
    case "SIGNED_OUT":
      return 401;
    case "WORKSPACE_NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "SERVER_UNREACHABLE":
    case "SERVER_ERROR":
      return 502;
    default:
      return 500;
  }
};

const respondError = (
  ctx: Context,
  error: PublishError,
) =>
  ctx.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    errorStatus(error.code),
  );

// Streams PublishEvents until `done` or `error`.
publishController.post(
  "/:workspaceId",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", publishBodySchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const { allowRemix } = ctx.req.valid("json");

    return streamSSE(ctx, async (stream) => {
      // The renderer leaving (or cancelling its fetch) cancels the publish.
      // Under protocol.handle the request signal never fires; onAbort, from
      // Hono cancelling the response body, is the hop that does (see the
      // chat stream route in api/index.ts). From `finishing` on the service
      // ignores the abort: the server may already have committed.
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());

      for await (const event of publishWorkspace(workspaceId, {
        ...(allowRemix !== undefined ? { allowRemix } : {}),
        signal: controller.signal,
      })) {
        // A write to a departed subscriber is swallowed by Hono; the run
        // carries on to its end (and its cleanup) either way.
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    });
  },
);

publishController.get(
  "/:workspaceId",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await getPublishStatus(workspaceId);

    if (result.isErr()) return respondError(ctx, result.error);

    return ctx.json({ site: result.value });
  },
);

publishController.patch(
  "/:workspaceId",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", allowRemixBodySchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const { allowRemix } = ctx.req.valid("json");
    const result = await setAllowRemix(workspaceId, allowRemix);

    if (result.isErr()) return respondError(ctx, result.error);

    return ctx.json({ site: result.value });
  },
);

// Ends an in-flight publish, unless it has reached `finishing`.
publishController.post(
  "/:workspaceId/cancel",
  zValidator("param", workspaceIdParamSchema),
  (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    cancelPublish(workspaceId);
    return ctx.json({ ok: true });
  },
);

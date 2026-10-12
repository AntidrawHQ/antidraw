import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { isComponentName } from "@/shared/utils/component-name";
import type { Style } from "@/shared/design";
import type { EditContext } from "@/shared/utils/canvas-edits";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import {
  describePendingEdits,
  listEdits,
  putEdit,
  releaseApplied,
  removeEdits,
} from "../services/edit.service";
import { editEvents } from "@/main/lib/edit-events";

// A workspace's design edits, under /workspaces/:workspaceId/edits. Held in
// memory (services/edit.service).
export const editController = new Hono();

const workspaceParam = z.object({ workspaceId: z.uuid() });
const idParam = workspaceParam.extend({ id: z.coerce.number().int() });

// The styles and the element are the canvas's, as its frames read them:
// taken as they come.
const putSchema = z.object({
  componentName: z.string().refine(isComponentName),
  element: z
    .object({ ref: z.object({ loc: z.string().nullable(), index: z.number(), path: z.array(z.number()), tag: z.string() }) })
    .passthrough()
    .transform((v) => v as unknown as ElementInfo),
  name: z.string(),
  text: z.boolean(),
  base: z.record(z.string(), z.unknown()).transform((v) => v as unknown as Style),
  now: z.record(z.string(), z.unknown()).transform((v) => v as unknown as Style),
  seen: z
    .record(z.string(), z.unknown())
    .nullable()
    .transform((v) => v as unknown as ElementContext | null),
});

const editContextSchema = z.object({
  id: z.number().int(),
  block: z.string().nullable(),
  preview: z.string().nullable(),
  frame: z.string().nullable(),
}) satisfies z.ZodType<EditContext>;

const promptSchema = z.object({ context: z.array(editContextSchema).min(1) });

const fail = (ctx: { json: (body: unknown, status: 404 | 409 | 500) => Response }, e: { status: 404 | 409 | 500; code: string; message: string }) =>
  ctx.json({ error: { code: e.code, message: e.message } }, e.status);

editController.get("/:workspaceId/edits", zValidator("param", workspaceParam), (ctx) => {
  const { workspaceId } = ctx.req.valid("param");
  return ctx.json(listEdits(workspaceId)._unsafeUnwrap());
});

// One element's edits as the panel has them now: its edit, or null once
// it's back where it started.
editController.put(
  "/:workspaceId/edits",
  zValidator("param", workspaceParam),
  zValidator("json", putSchema),
  (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    return ctx.json(putEdit(workspaceId, ctx.req.valid("json"))._unsafeUnwrap());
  },
);

// Reset: every edit not yet applied.
editController.delete("/:workspaceId/edits", zValidator("param", workspaceParam), (ctx) => {
  const { workspaceId } = ctx.req.valid("param");
  removeEdits(workspaceId);
  return ctx.json({ ok: true });
});

editController.delete("/:workspaceId/edits/:id", zValidator("param", idParam), (ctx) => {
  const { workspaceId, id } = ctx.req.valid("param");
  const result = removeEdits(workspaceId, id);
  return result.isErr() ? fail(ctx, result.error) : ctx.json({ ok: true });
});

// Stop showing a set being applied.
editController.delete("/:workspaceId/edits/applied/:id", zValidator("param", idParam), (ctx) => {
  const { workspaceId, id } = ctx.req.valid("param");
  const result = releaseApplied(workspaceId, id);
  return result.isErr() ? fail(ctx, result.error) : ctx.json({ ok: true });
});

// The message that applies the edits in `context`. Changes nothing: the
// send is POST /chat/message with their editIds, the composer's own send, as
// comments' is.
editController.post(
  "/:workspaceId/edits/prompt",
  zValidator("param", workspaceParam),
  zValidator("json", promptSchema),
  (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = describePendingEdits(workspaceId, ctx.req.valid("json").context);
    return result.isErr() ? fail(ctx, result.error) : ctx.json(result.value);
  },
);

// The edits' news: "changed" whenever the workspace's edits do. Subscribers
// refetch, as the comments' events (comment.controller) explain.
editController.get("/:workspaceId/edits/events", zValidator("param", workspaceParam), (ctx) => {
  const { workspaceId } = ctx.req.valid("param");
  return streamSSE(ctx, async (stream) => {
    const send = () => {
      void stream.writeSSE({ data: JSON.stringify({ type: "changed" }) });
    };
    const onEdits = (id: string) => {
      if (id === workspaceId) send();
    };
    editEvents.on("changed", onEdits);
    const detach = () => {
      editEvents.off("changed", onEdits);
    };
    ctx.req.raw.signal.addEventListener("abort", detach);
    stream.onAbort(detach);

    try {
      send();
      await new Promise<void>((resolve) => {
        if (stream.aborted || stream.closed || ctx.req.raw.signal.aborted) {
          resolve();
          return;
        }
        const leave = () => resolve();
        stream.onAbort(leave);
        ctx.req.raw.signal.addEventListener("abort", leave, { once: true });
      });
    } finally {
      detach();
    }
  });
});

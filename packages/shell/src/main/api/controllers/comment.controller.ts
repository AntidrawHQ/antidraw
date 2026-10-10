import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { isComponentName } from "@/shared/utils/component-name";
import {
  addComment,
  clearCompleted,
  editComment,
  isCommentChat,
  listComments,
  removeComment,
  describeDrafts,
} from "../services/comment.service";
import type { CommentContext } from "@/shared/utils/canvas-comments";
import { commentEvents } from "@/main/lib/comment-events";
import { conversationEvents } from "@/main/lib/conversation-store";

// A workspace's comments for Claude, under /workspaces/:workspaceId/comments.
export const commentController = new Hono();

const workspaceParam = z.object({ workspaceId: z.uuid() });
const commentParam = workspaceParam.extend({ id: z.coerce.number().int() });

const addSchema = z.object({
  componentName: z.string().refine(isComponentName),
  x: z.number(),
  y: z.number(),
  text: z.string().trim().min(1),
  element: z.record(z.string(), z.unknown()).nullable(),
});

const editSchema = z.object({ text: z.string().trim().min(1) });

const commentContextSchema = z.object({
  id: z.number().int(),
  element: z.string().nullable(),
  preview: z.string().nullable(),
  frame: z.string().nullable(),
}) satisfies z.ZodType<CommentContext>;

const promptSchema = z.object({
  context: z.array(commentContextSchema).min(1),
  // The chat it's for, if one's open: its own set isn't history to it.
  conversationId: z.uuid().optional(),
});

commentController.get(
  "/:workspaceId/comments",
  zValidator("param", workspaceParam),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await listComments(workspaceId);
    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }
    return ctx.json(result.value);
  },
);

commentController.post(
  "/:workspaceId/comments",
  zValidator("param", workspaceParam),
  zValidator("json", addSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await addComment(workspaceId, ctx.req.valid("json"));
    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }
    return ctx.json(result.value, 201);
  },
);

commentController.patch(
  "/:workspaceId/comments/:id",
  zValidator("param", commentParam),
  zValidator("json", editSchema),
  async (ctx) => {
    const { workspaceId, id } = ctx.req.valid("param");
    const result = await editComment(workspaceId, id, ctx.req.valid("json").text);
    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }
    return ctx.json(result.value);
  },
);

commentController.delete(
  "/:workspaceId/comments/:id",
  zValidator("param", commentParam),
  async (ctx) => {
    const { workspaceId, id } = ctx.req.valid("param");
    const result = await removeComment(workspaceId, id);
    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }
    return ctx.json({ ok: true });
  },
);

commentController.post(
  "/:workspaceId/comments/clear-completed",
  zValidator("param", workspaceParam),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await clearCompleted(workspaceId);
    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }
    return ctx.json({ ok: true });
  },
);

// The message for sending the drafts to a chat, `conversationId` if one's
// open. Changes nothing: the send is POST /chat/message with the drafts'
// commentIds, the composer's own send, so a comment message is sent, queued,
// shown and retried like any other.
commentController.post(
  "/:workspaceId/comments/prompt",
  zValidator("param", workspaceParam),
  zValidator("json", promptSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const { context, conversationId } = ctx.req.valid("json");
    const result = await describeDrafts(workspaceId, context, conversationId);
    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }
    return ctx.json(result.value);
  },
);

// The list's news: "changed" whenever the workspace's comments do (any
// write, the user's or Claude's) or one of its comment chats moves on (a
// set shows its chat's phase). Subscribers refetch the list. Nothing to
// resume: the list is read whole, so a reconnect only needs a refetch, and
// the "changed" sent on every open is that.
commentController.get(
  "/:workspaceId/comments/events",
  zValidator("param", workspaceParam),
  (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    return streamSSE(ctx, async (stream) => {
      const send = () => {
        void stream.writeSSE({ data: JSON.stringify({ type: "changed" }) });
      };
      const onComments = (id: string) => {
        if (id === workspaceId) send();
      };
      const onState = (conversationId: string) => {
        void isCommentChat(workspaceId, conversationId).then((r) => {
          if (r.isOk() && r.value) send();
        });
      };
      commentEvents.on("changed", onComments);
      conversationEvents.on("state", onState);
      const detach = () => {
        commentEvents.off("changed", onComments);
        conversationEvents.off("state", onState);
      };

      // Both hooks, and the park below, as /chat/:id/stream explains: under
      // Electron's protocol.handle only onAbort fires; elsewhere (tests, a
      // remote server) the request signal does.
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
  },
);

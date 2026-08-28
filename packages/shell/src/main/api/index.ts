import { Hono } from "hono";
export type {
  Conversation,
  Message,
  ConversationWithMessages,
  StreamStatus,
} from "./models/chat.model";
import type { Message } from "./models/chat.model";
export type { Workspace } from "./models/workspace.model";
export type { CreateWorkspaceResponse } from "./controllers/workspace.controller";
export type { CreateWorkspaceStatusCode } from "./services/workspace.service";
export type { DevServerState } from "@/main/lib/runtime-store";
export type { DevServerInfo } from "@/main/services/dev-server.service";
export type { EffortLevel, ModelInfo } from "./claude-code-ops";
export type {
  ComponentListItem,
  ComponentSource,
  ComponentStreamEvent,
} from "./services/component.service";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  generateTitle,
  getSupportedModels,
} from "@/main/api/claude-code-ops";
import {
  createConversation,
  resolveOrCreateConversation,
  updateConversationTitleAndSummary,
  deleteMessage,
  getConversation,
  getMessagesAfterSeq,
} from "./services/chat.service";
import {
  subscribe,
  getPending,
  getPartial,
  getCliState,
  interrupt,
  cancelQueued,
  type StreamEvent,
} from "@/main/lib/conversation-store";
export type { StreamEvent } from "@/main/lib/conversation-store";
import { runTurn } from "./turn";
import { workspaceController } from "./controllers/workspace.controller";
import { preferenceController } from "./controllers/preference.controller";
import { claudeCliInteractionsController } from "./controllers/claude-cli-interactions.controller";

const api = new Hono();

api.route("/workspaces", workspaceController);
api.route("/preferences", preferenceController);
api.route("/claude-cli", claudeCliInteractionsController);

const imageAttachmentSchema = z.object({
  data: z.string(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
});

export const effortLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const chatMessageSchema = z.object({
  message: z.string().min(1),
  workspaceId: z.uuid(),
  conversationId: z.string().uuid().optional(),
  userMessageId: z.string().uuid(),
  images: z.array(imageAttachmentSchema).optional(),
  model: z.string().min(1).optional(),
  effort: effortLevelSchema.optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

api.post(
  "/chat/message",
  zValidator("json", chatMessageSchema),
  async (ctx) => {
    const { message, workspaceId, conversationId, userMessageId, images, model, effort } =
      ctx.req.valid("json");

    const conversationRes = await resolveOrCreateConversation(
      workspaceId,
      conversationId,
    );

    if (conversationRes.isErr()) {
      const { status, code, message } = conversationRes.error;
      return ctx.json({ error: { code, message } }, status);
    }

    const conversation = conversationRes.value;

    runTurn({
      conversation,
      workspaceId,
      message,
      userMessageId,
      images,
      options: { model, effort },
    }).catch(console.error);

    return ctx.json({ conversationId: conversation.id }, 202);
  },
);

api.get(
  "/chat/:conversationId",
  zValidator(
    "param",
    z.object({
      conversationId: z.uuid(),
    }),
  ),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    const conversation = await getConversation(conversationId, {
      includeMessages: true,
    });

    if (conversation.isErr()) {
      const { status, code, message } = conversation.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(conversation.value);
  },
);

// `afterSeq` is the last message seq the subscriber already has. Present, it
// asks for the transcript after that point to be replayed before live events
// start; absent, there is no replay. A resuming client passes it so a drop
// costs it nothing, and a first-time subscriber passes it too — the gap
// between GET /chat/:id reading the DB and this route attaching its listener
// is the same gap, just a smaller one.
const streamQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
});

api.get(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  zValidator("query", streamQuerySchema),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");
    const { afterSeq } = ctx.req.valid("query");

    const conversation = await getConversation(conversationId);
    if (conversation.isErr()) {
      const { status, code, message } = conversation.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return streamSSE(ctx, async (stream) => {
      // Writes are chained rather than awaited at each call site: send() stays
      // synchronous, so the ordering below is the ordering on the wire, and a
      // listener that fires mid-await cannot interleave its frame into one
      // already being written.
      // A rejected link stays rejected, so the chain is caught at each step
      // rather than propagating one unhandled rejection per later event. The
      // only way a write fails is the subscriber having gone, and the abort
      // listener below is what answers for that; there is nobody left to tell.
      let writes = Promise.resolve();
      let writable = true;
      const send = (event: StreamEvent) => {
        if (!writable) return;
        writes = writes
          .then(() => stream.writeSSE({ data: JSON.stringify(event) }))
          .catch(() => {
            writable = false;
          });
      };

      // Attach BEFORE reading the backlog, and hold what arrives. Reading
      // first would reopen the very gap the replay exists to close: anything
      // emitted between the read and the attach would reach nobody.
      let buffered: StreamEvent[] | null = [];
      const unsubscribe = subscribe(conversationId, (event) => {
        if (buffered) buffered.push(event);
        else send(event);
      });
      ctx.req.raw.signal.addEventListener("abort", unsubscribe);

      // Captured now, sent below. Taking them before the await is what makes
      // them safe to send late: every change after this point is in `buffered`
      // and gets replayed on top.
      const seeds: StreamEvent[] = [
        { type: "state", state: getCliState(conversationId) },
        { type: "queue", userMessageIds: getPending(conversationId) },
        { type: "livePartial", livePartial: getPartial(conversationId) },
      ];

      let replayedThrough = afterSeq ?? 0;
      if (afterSeq !== undefined) {
        const backlog = await getMessagesAfterSeq(conversationId, afterSeq);
        for (const message of backlog) send({ type: "message", message });
        replayedThrough = backlog.at(-1)?.seq ?? afterSeq;
      }

      // After the backlog, not before: the seeded livePartial is the block in
      // flight now, and the renderer drops the live block on any persisted
      // assistant message. Seeding first would let an older backlog message
      // clear a partial that is still streaming.
      for (const seed of seeds) send(seed);

      // One synchronous drain — no await inside, so nothing can arrive while
      // the buffer is half-empty. Everything past this point sends directly.
      const pending = buffered;
      buffered = null;
      for (const event of pending) {
        // A message can be in both halves: persisted before the read, emitted
        // after the attach. The renderer dedups by id anyway; this keeps the
        // duplicate off the wire.
        if (event.type === "message" && event.message.seq <= replayedThrough) {
          continue;
        }
        send(event);
      }

      await new Promise(() => {});
    });
  },
);

api.get("/models", async (ctx) => {
  try {
    const models = await getSupportedModels();
    return ctx.json({ models });
  } catch (e) {
    console.error("Failed to load model catalog:", e);
    return ctx.json(
      {
        error: {
          code: "MODEL_CATALOG_ERROR",
          message: "Failed to load model catalog",
        },
      },
      500,
    );
  }
});

api.delete(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    if (await interrupt(conversationId)) {
      return ctx.json({ cancelled: true });
    }

    return ctx.json({ cancelled: false }, 404);
  },
);

api.delete(
  "/chat/:conversationId/message/:userMessageId",
  zValidator(
    "param",
    z.object({ conversationId: z.uuid(), userMessageId: z.uuid() }),
  ),
  async (ctx) => {
    const { conversationId, userMessageId } = ctx.req.valid("param");

    const cancelled = await cancelQueued(conversationId, userMessageId);
    if (!cancelled) {
      return ctx.json({ cancelled: false });
    }

    const deleted = await deleteMessage(userMessageId);
    if (deleted.isErr()) {
      console.error("Failed to delete cancelled message row:", deleted.error);
    }

    return ctx.json({ cancelled: true });
  },
);

const createConversationSchema = z.object({
  workspaceId: z.uuid(),
});

api.post(
  "/chat/conversation",
  zValidator("json", createConversationSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("json");
    const result = await createConversation(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value, 201);
  },
);

const generateTitleSchema = z.object({
  firstMessage: z.string().min(1),
});

api.post(
  "/chat/:conversationId/generate-title",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  zValidator("json", generateTitleSchema),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");
    const { firstMessage } = ctx.req.valid("json");

    const result = await generateTitle(firstMessage);

    if (result.isErr()) {
      return ctx.json(
        { error: { code: result.error, message: "Failed to generate title" } },
        500,
      );
    }

    const { title, summary } = result.value;
    const updateResult = await updateConversationTitleAndSummary(
      conversationId,
      title,
      summary,
    );

    if (updateResult.isErr()) {
      const { status, code, message } = updateResult.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ title, summary });
  },
);

export const app = new Hono();
app.route("/api", api);

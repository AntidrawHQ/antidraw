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
      // Order on the wire is call order: writeSSE hands each frame to the
      // stream's writer in the order it was called, and the writer queues.
      // A write to a subscriber that has gone is swallowed inside Hono, so
      // there is nothing to catch here — the teardown hooks below are what
      // answer for a departure.
      const send = (event: StreamEvent) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      };

      // Attach first, and let live events straight through. Reading the
      // backlog before attaching would lose anything emitted in between;
      // attaching first turns that gap into an overlap, and the renderer
      // absorbs the overlap: messages dedup by id and sort by seq, so it does
      // not matter that a live message can land here ahead of older rows.
      const unsubscribe = subscribe(conversationId, send);

      // Two hooks for one teardown, because the one that is easy to test is
      // not the one that fires in the app. `req.signal` is the ending Hono
      // gives a caller-supplied AbortSignal, which is how the tests drive
      // this route. Under Electron's protocol.handle it is dead: the
      // handler's Request is built as `new Request(url, { headers, method,
      // referrer, body, duplex })` with no signal at all, so it owns one
      // nothing holds a controller for — it stays unfired through a
      // renderer-side fetch abort and even through destroying the renderer
      // outright (verified against 39.2.7). What that abort does reach is the
      // response body, which Hono cancels and surfaces as onAbort. That is
      // the hop that detaches these listeners in production; without it every
      // conversation opened keeps a live subscriber for the rest of the
      // session, serialising each event into a dead stream whose failed
      // writes Hono swallows.
      //
      // Both can fire for one request. Unsubscribing twice is a no-op:
      // EventEmitter.off finds nothing the second time.
      ctx.req.raw.signal.addEventListener("abort", unsubscribe);
      stream.onAbort(unsubscribe);

      // Both hooks answer a departure; the finally answers an unwind. A
      // rejection below would be caught by Hono, which closes the stream —
      // close, not abort, so neither hook fires: the body ends cleanly, the
      // client sees a resumable drop, and the listeners would stay attached
      // for the life of the process, serialising every later event into a
      // dead writer whose failed writes Hono swallows. The park at the
      // bottom never settles, so this finally cannot fire on the happy path
      // — it exists for the throw that is not supposed to happen.
      try {
        if (afterSeq !== undefined) {
          const backlog = await getMessagesAfterSeq(conversationId, afterSeq);
          if (backlog.isErr()) {
            // A failed replay is not a failed connection: the live half has
            // no DB dependency, and the seeds below still describe the
            // present. The client's cursor only advances on a clean end, so
            // the rows this read owed it are owed by the next attach instead.
            console.error(
              `Backlog replay failed for ${conversationId}:`,
              backlog.error.message,
            );
          } else {
            for (const message of backlog.value)
              send({ type: "message", message });
          }
        }

        // Seeds go last and are read now, after the await, so everything ahead
        // of them on the wire is older than they are. They are whole-state, so
        // arriving last is what makes them right: an assistant message that
        // came through before them — backlog or live — makes the renderer drop
        // its live block, and the seed then installs whichever block is in
        // flight now, or none.
        send({ type: "state", state: getCliState(conversationId) });
        send({ type: "queue", userMessageIds: getPending(conversationId) });
        send({ type: "livePartial", livePartial: getPartial(conversationId) });

        await new Promise(() => {});
      } finally {
        unsubscribe();
      }
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

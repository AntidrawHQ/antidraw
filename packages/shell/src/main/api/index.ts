import { Hono } from "hono";
export type {
  Conversation,
  Message,
  ConversationWithMessages,
  StreamStatus,
} from "./models/chat.model";
import type { Conversation, Message } from "./models/chat.model";
export type { Workspace } from "./models/workspace.model";
export type { CreateWorkspaceResponse } from "./controllers/workspace.controller";
export type { CreateWorkspaceStatusCode } from "./services/workspace.service";
export type { DevServerState } from "@/main/lib/runtime-store";
export type { DevServerInfo } from "@/main/services/dev-server.service";
export type { EffortLevel, ModelInfo } from "./claude-code-ops";
export type { StreamEvent } from "@/main/lib/stream-manager";
export type {
  ComponentListItem,
  ComponentSource,
  ComponentStreamEvent,
} from "./services/component.service";
import type { UUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  sendMessage,
  generateTitle,
  buildPrompt,
  getSupportedModels,
  type EffortLevel,
} from "@/main/api/claude-code-ops";
import {
  createConversation,
  addMessage,
  updateConversationSession,
  updateConversationTitleAndSummary,
  deleteMessage,
  getConversation,
  setConversationOptions,
} from "./services/chat.service";
import {
  streamEvents,
  emitStreamEvent,
  activeStreams,
  claimStream,
  markPending,
  clearPending,
  clearAllPending,
  getStreamStatus,
  queueSnapshot,
  cancelStream as cancelActiveStream,
  cancelQueuedMessage,
  type StreamEvent,
} from "@/main/lib/stream-manager";
import { createUserSDKMessage } from "@/shared/utils/message";
import { workspaceController } from "./controllers/workspace.controller";
import { preferenceController } from "./controllers/preference.controller";
import { claudeCliInteractionsController } from "./controllers/claude-cli-interactions.controller";
import type { ImageAttachment } from "@/shared/utils/message";
import { trackMessageSent } from "@/main/lib/posthog";

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
  conversationId: z.uuid(),
  userMessageId: z.string().uuid(), // Frontend-generated, used for dedup
  images: z.array(imageAttachmentSchema).optional(),
  // The composer's model/effort selection, snapshotted at send time. This is
  // the ONLY write path for a conversation's options: the send persists the
  // snapshot on the row (the picker's default next time) and applies it to
  // the CLI. Absent = CLI defaults.
  model: z.string().min(1).optional(),
  effort: effortLevelSchema.optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// One send. Synchronously decides owner-vs-follow-up (claimStream), then
// either spawns the CLI and owns its lifecycle, or pushes into the live one.
// The owning loop is the only writer of stream state; everything the
// renderer needs is emitted as StreamEvents and mirrored into its cache.
const processStream = async (
  conversation: Conversation,
  message: string,
  workspaceId: string,
  userMessageId: string,
  images?: ImageAttachment[],
  options?: { model?: string; effort?: EffortLevel },
) => {
  // The fork. Win it and we cold-start below; lose it and a stream is live
  // (or spawning), so this send is a follow-up pushed into it. Decided in
  // one synchronous step so two concurrent sends cannot both cold-start.
  // A follow-up is marked pending right here, before the first await, so
  // the renderer's "Queued" mark and cancel can see it immediately.
  const promptStream = buildPrompt(message, {
    uuid: userMessageId as UUID,
    images,
  });
  const { owned, stream } = claimStream(conversation.id, promptStream);
  if (!owned) markPending(conversation.id, userMessageId);

  // Persist the options snapshot (the picker's default next time). Model is
  // a full overwrite; effort is preserved when absent — a Haiku turn must
  // not erase the effort the user chose for this conversation.
  const persisted = await setConversationOptions(conversation.id, {
    selectedModel: options?.model ?? null,
    ...(options?.effort !== undefined ? { selectedEffort: options.effort } : {}),
  });
  if (persisted.isErr()) {
    console.error("Failed to persist options snapshot:", persisted.error);
  }

  // Persist the prompt once, for both paths, keyed by the frontend's id so
  // the renderer's optimistic bubble dedups against the `message` event.
  await addMessage({
    id: userMessageId,
    conversationId: conversation.id,
    messageType: "user_prompt",
    sdkMessage: createUserSDKMessage({
      text: message,
      uuid: userMessageId as UUID,
      images,
    }),
  });

  // Follow-up: push into the owner's input stream. The CLI queues it and
  // folds it into the running turn at its next tool boundary (or runs it as
  // the next turn); its replay ack clears the pending mark. This invocation
  // owns no lifecycle — the owning loop persists the pushed turn's output.
  if (!owned) {
    try {
      // Apply this send's options before the push (setModel applies at the
      // next turn boundary, effortLevel immediately). No query yet = the
      // owner's CLI is still spawning with that send's options; this turn
      // inherits them. applyFlagSettings accepts "max" at runtime — the
      // SDK's Settings.effortLevel type omits it, hence the cast.
      if (stream.query) {
        try {
          await stream.query.setModel(options?.model ?? undefined);
          await stream.query.applyFlagSettings({
            effortLevel: (options?.effort ?? null) as Exclude<
              EffortLevel,
              "max"
            > | null,
          });
        } catch (e) {
          console.error("Pre-push option apply failed:", e);
        }
      }
      // Enqueue is valid before the owner's CLI exists — the message waits
      // in the ReadableStream and is consumed once the query attaches.
      stream.promptStream.push(message, {
        uuid: userMessageId as UUID,
        images,
      });
      if (stream.query) trackMessageSent({ query: stream.query });
    } catch (e) {
      // The message never reached the CLI, so it will never be acked.
      console.error("Failed to push follow-up turn:", e);
      clearPending(conversation.id, userMessageId);
    }
    return;
  }

  // Owner: spawn and run the loop until the CLI goes away.
  try {
    const res = sendMessage({
      promptStream,
      workspaceId,
      claudeCodeSessionID: conversation.claudeCodeSessionId ?? undefined,
      model: options?.model,
      effort: options?.effort,
    });
    if (res.isErr()) throw new Error("Failed to init Claude Code");
    stream.query = res.value;
    trackMessageSent({ query: res.value });

    let sessionId = conversation.claudeCodeSessionId ?? undefined;

    for await (const sdkMessage of res.value) {
      // Partials: relay, never persist.
      if (sdkMessage.type === "stream_event") {
        emitStreamEvent(conversation.id, {
          type: "partial",
          partial: sdkMessage,
        });
        continue;
      }

      // The CLI's session state is the lifecycle: `running` = a turn is in
      // flight; `idle` = the turn AND the CLI's command queue are drained
      // (it is not emitted between a turn's result and a queued follow-up —
      // verified live). `result` is not a lifecycle signal.
      if (
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "session_state_changed"
      ) {
        stream.idle = sdkMessage.state === "idle";
        emitStreamEvent(conversation.id, {
          type: "status",
          status: stream.idle ? "idle" : "streaming",
        });
        continue;
      }

      // Replay ack (--replay-user-messages): the CLI re-emits a pushed user
      // message once it is folded into a turn, with the uuid we stamped.
      // That is acceptance — the pending mark goes. Not persisted: the
      // send-time user_prompt row is the single copy.
      if (
        sdkMessage.type === "user" &&
        "isReplay" in sdkMessage &&
        sdkMessage.isReplay
      ) {
        clearPending(conversation.id, sdkMessage.uuid);
        continue;
      }

      // New conversation: the first init carries the session id to resume.
      if (
        !sessionId &&
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "init"
      ) {
        const initSessionId: string | undefined = sdkMessage.session_id;
        if (initSessionId) {
          sessionId = initSessionId;
          await updateConversationSession(conversation.id, initSessionId);
        }
      }

      await addMessage({
        conversationId: conversation.id,
        messageType: "sdk_message",
        sdkMessage,
      });
    }
  } catch (e) {
    console.error("Stream ended with error:", e);
  } finally {
    // The stream is gone (CLI exited or died). Anything still un-acked will
    // never run; status derives to idle once the slot is freed.
    clearAllPending(conversation.id);
    activeStreams.delete(conversation.id);
    emitStreamEvent(conversation.id, { type: "status", status: "idle" });
  }
};

api.post(
  "/chat/message",
  zValidator("json", chatMessageSchema),
  async (ctx) => {
    const { message, workspaceId, conversationId, userMessageId, images, model, effort } =
      ctx.req.valid("json");

    const conversationRes = await getConversation(conversationId);
    if (conversationRes.isErr()) {
      const { status, code, message } = conversationRes.error;
      return ctx.json({ error: { code, message } }, status);
    }

    // Mid-turn sends are accepted: processStream's claim routes them as
    // pushes into the live stream. It registers the send synchronously
    // before its first await, so by the time the 202 is out the renderer's
    // queue_state already knows about it.
    processStream(conversationRes.value, message, workspaceId, userMessageId, images, {
      model,
      effort,
    }).catch(console.error);

    return ctx.json({ conversationId }, 202);
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

// SSE: initial state, then every StreamEvent for this conversation, until
// the client disconnects. The renderer keeps one open per open conversation.
api.get(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    const conversation = await getConversation(conversationId);
    if (conversation.isErr()) {
      const { status, code, message } = conversation.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return streamSSE(ctx, async (stream) => {
      const send = (event: StreamEvent) =>
        stream.writeSSE({ data: JSON.stringify(event) });

      // Truth first, then deltas: a (re)connecting renderer starts current.
      send({ type: "status", status: getStreamStatus(conversationId) });
      send({ type: "queue_state", userMessageIds: queueSnapshot(conversationId) });

      const onEvent = (convId: string, event: StreamEvent) => {
        if (convId === conversationId) send(event);
      };
      streamEvents.on("event", onEvent);
      ctx.req.raw.signal.addEventListener("abort", () =>
        streamEvents.off("event", onEvent),
      );

      await new Promise(() => {});
    });
  },
);

// The CLI's live model catalog (names, ids, supported effort levels). Served
// from a session-lifetime cache in main — see getSupportedModels; the first
// request pays one short-lived CLI spawn (~1.5s), no turn ever runs.
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

// Cancel an active stream
api.delete(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    // Just trigger interrupt - stream will end naturally via processStream
    if (await cancelActiveStream(conversationId)) {
      return ctx.json({ cancelled: true });
    }

    return ctx.json({ cancelled: false }, 404);
  },
);

// Withdraw a queued (sent mid-turn, not yet accepted) message. The CLI is
// the authority: true = dropped, never runs, never acked — its row goes too
// (queue_state already told the renderer). false = it already entered a
// turn, or never reached the CLI; it runs and its ack clears the mark.
api.delete(
  "/chat/:conversationId/message/:userMessageId",
  zValidator(
    "param",
    z.object({ conversationId: z.uuid(), userMessageId: z.uuid() }),
  ),
  async (ctx) => {
    const { conversationId, userMessageId } = ctx.req.valid("param");
    const cancelled = await cancelQueuedMessage(conversationId, userMessageId);
    if (cancelled) {
      const deleted = await deleteMessage(userMessageId);
      if (deleted.isErr()) {
        console.error("Failed to delete cancelled message row:", deleted.error);
      }
    }
    return ctx.json({ cancelled });
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

// Mount the API under /api so the renderer can be served same-origin from
// antidraw://app/ and reach the API at antidraw://app/api/*. Same origin
// avoids CORS preflights and lets SSE/fetch behave like a normal web app.
export const app = new Hono();
app.route("/api", api);

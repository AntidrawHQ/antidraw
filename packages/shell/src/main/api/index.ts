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
export type {
  ComponentListItem,
  ComponentSource,
  ComponentStreamEvent,
} from "./services/component.service";
import type { UUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  sendMessage,
  generateTitle,
  buildPrompt,
  getSupportedModels,
  type EffortLevel,
} from "@/main/api/claude-code-ops";
import {
  createConversation,
  resolveOrCreateConversation,
  addMessage,
  updateConversationSession,
  updateConversationStatus,
  updateConversationTitleAndSummary,
  convertUserPromptToSDKMessage,
  deleteMessage,
  getConversation,
  setConversationOptions,
} from "./services/chat.service";
import {
  streamEvents,
  activeStreams,
  claimStream,
  attachQuery,
  unregisterStream,
  cancelStream as cancelActiveStream,
  cancelQueuedMessage,
  type ActiveStream,
} from "@/main/lib/stream-manager";
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
  conversationId: z.string().uuid().optional(),
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

// Stream event types for SSE
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "partial"; partial: SDKPartialAssistantMessage }
  // The CLI folded a mid-turn send into a turn (replay ack). The renderer
  // drops its "Queued" mark for that userMessageId.
  | { type: "message_accepted"; userMessageId: string }
  // The CLI reported `running`: a turn is in flight. Counterpart of
  // `complete`; the renderer flips to streaming and keeps listening.
  | { type: "streaming" }
  // Sent once on every SSE subscribe: the un-acked queued messages right
  // now, so a (re)subscribing renderer rebuilds its "Queued" marks from the
  // truth instead of client memory.
  | { type: "queue_state"; userMessageIds: string[] }
  | { type: "complete" }
  | { type: "error"; error: string }
  // Actual per-turn effort echoed by the CLI's Stop hook. Transport only —
  // no renderer consumer yet; reserved for deviation-feedback UI.
  | { type: "effort"; level: string };

// End of turn = the CLI said `idle` AND nothing we pushed is still
// un-acked. The owning loop calls this on `idle`; it is also called from
// the two places that can empty the pending set while the CLI is already
// idle — a successful cancel, a failed push — because the CLI will say
// nothing more in that case. Idempotent per idle (idleSettled), reset by
// the next `running`. No-op while the CLI is running or spawning.
const settleIdle = async (conversationId: string) => {
  const stream = activeStreams.get(conversationId);
  if (!stream || stream.cliState !== "idle" || stream.idleSettled) return;
  if (stream.pendingUserMessageIds.size > 0) return;
  stream.idleSettled = true;
  disarmIdleWatchdog(stream);
  await updateConversationStatus(conversationId, "idle");
  streamEvents.emit("complete", conversationId);
};

// `idle` arrived with a push still in flight on stdin. The CLI's `running`
// for it follows within milliseconds; if it never comes the push was lost
// (dead input, CLI ignored it) and the hold must not last forever. On
// expiry the lost ids are forgotten (their rows remain — the renderer's
// marks clear on complete) and the turn closes.
const IDLE_WATCHDOG_MS = 30_000;

const disarmIdleWatchdog = (stream: ActiveStream) => {
  if (stream.idleWatchdog) clearTimeout(stream.idleWatchdog);
  stream.idleWatchdog = null;
};

const armIdleWatchdog = (conversationId: string, stream: ActiveStream) => {
  disarmIdleWatchdog(stream);
  stream.idleWatchdog = setTimeout(() => {
    stream.idleWatchdog = null;
    if (stream.cliState !== "idle" || stream.idleSettled) return;
    console.error(
      "CLI idle but pushes never acked after",
      IDLE_WATCHDOG_MS,
      "ms; releasing",
      [...stream.pendingUserMessageIds],
    );
    stream.pendingUserMessageIds.clear();
    void settleIdle(conversationId);
  }, IDLE_WATCHDOG_MS);
};

// Background processor for streaming messages
const processStream = async (
  conversation: Conversation,
  message: string,
  workspaceId: string,
  userMessageId: string,
  images?: ImageAttachment[],
  options?: { model?: string; effort?: EffortLevel },
) => {
  // Model/effort travel WITH the message: the composer snapshots its
  // selection into the send request, and this is the only moment options
  // exist server-side — persisted to the row (the picker's default next
  // time) and applied to the CLI via spawn options (cold start) or control
  // requests (push path). No other writer exists, so there is nothing to
  // race and nothing to re-read.

  // Claim the conversation's stream slot. This single synchronous call is the
  // fork: win it and we cold-start and own the lifecycle below; lose it and a
  // stream is already live (or spawning), so this turn is a follow-up push.
  // Deciding both outcomes in one uninterruptible step is what stops two
  // concurrent sends from each cold-starting and clobbering the other.
  const promptStream = buildPrompt(message, {
    uuid: userMessageId as UUID,
    images,
  });
  const owned = claimStream(conversation.id, promptStream);
  // Win or lose, the slot exists now and nothing has awaited since the
  // claim, so this lookup cannot miss. A follow-up is tracked as pending
  // from here, BEFORE the first await: if the CLI's `idle` for the current
  // turn lands while we are still persisting, the owning loop sees the
  // pending id and holds instead of closing the turn under us. The owner's
  // own first message is not tracked — it is the spawn prompt, never
  // "queued", and the CLI reports `running` for it before anything else.
  const stream = activeStreams.get(conversation.id)!;
  if (!owned) stream.pendingUserMessageIds.add(userMessageId);

  // Persist the snapshot. Model is a full overwrite (absent = the "Default"
  // pick, i.e. CLI default); effort is preserved when absent — the composer
  // omits it only for models with no effort levels, and a Haiku turn must
  // not erase the effort the user chose for this conversation. Failure only
  // costs the persisted default (the CLI still gets the options below).
  const persisted = await setConversationOptions(conversation.id, {
    selectedModel: options?.model ?? null,
    ...(options?.effort !== undefined ? { selectedEffort: options.effort } : {}),
  });
  if (persisted.isErr()) {
    console.error("Failed to persist options snapshot:", persisted.error);
  }

  // Push path. Persist the user message with the frontend-assigned id (dedup
  // contract) then push into the owner's input stream. This invocation owns NO
  // stream lifecycle, so it stays out of the try/finally below and never
  // unregisters — the owning loop picks up the pushed turn's SDK messages and
  // persists them.
  if (!owned) {
    try {
      const userMsg = convertUserPromptToSDKMessage(
        message,
        userMessageId as UUID,
        images,
      );
      await addMessage({
        id: userMessageId,
        conversationId: conversation.id,
        messageType: "user_prompt",
        sdkMessage: userMsg,
      });
      // Apply this send's options before the push. setModel applies at the
      // next turn boundary — exactly the turn being pushed (verified: an
      // in-flight turn is unaffected); effortLevel applies immediately.
      // applyFlagSettings accepts "max" at runtime — the SDK's
      // Settings.effortLevel type omits it, hence the cast. No query yet =
      // the owner's CLI is still spawning; its spawn already carries that
      // send's options, so this turn just inherits them (the row snapshot
      // above keeps the record straight either way).
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
          // Best-effort, log only — nothing to tear down (a dead process
          // throws out of the owning loop within ~10ms and its finally
          // cleans up; a wedged one never settles this await at all). The
          // snapshot is persisted above, so the selection rides the next
          // send's cold start.
          console.error(
            "Pre-push option apply failed; applies next cold start:",
            e,
          );
        }
      }
      // Enqueue is valid before the owner's CLI exists — the message waits in
      // the ReadableStream and is consumed once the query attaches. The CLI
      // queues it and folds it into the live turn at its next tool boundary
      // (or starts a fresh turn if the current one already finalized); the
      // replay ack tells us which.
      stream.promptStream.push(message, {
        uuid: userMessageId as UUID,
        images,
      });
      if (stream.query) trackMessageSent({ query: stream.query });
    } catch (e) {
      // Don't tear down the live stream or emit a terminal "error" — the
      // owning loop is still running. Just log; the failed push leaves the
      // optimistic message unconfirmed, which a refetch reconciles. It will
      // never be acked, so stop tracking it — and if the loop was holding a
      // turn open only for it, close that turn.
      console.error("Failed to push follow-up turn:", e);
      stream.pendingUserMessageIds.delete(userMessageId);
      await settleIdle(conversation.id);
    }
    return;
  }

  // Cold-start path: spawn a fresh query and own its lifecycle. The
  // try/finally below is scoped to THIS invocation's stream — the finally
  // unregisters only because we claimed above.
  try {
    const claudeCodeSessionID = conversation.claudeCodeSessionId ?? undefined;

    const res = sendMessage({
      promptStream,
      workspaceId,
      claudeCodeSessionID,
      model: options?.model,
      effort: options?.effort,
      onEffortLevel: (level) =>
        streamEvents.emit("effort", conversation.id, level),
    });

    if (res.isErr()) {
      throw new Error("Failed to init Claude Code");
    }

    // Slot is already ours; fill in the query so cancel/option-apply can
    // reach it.
    attachQuery(conversation.id, res.value);

    trackMessageSent({ query: res.value });

    let sessionId = claudeCodeSessionID;

    // For RESUMED conversations: persist user message immediately with frontend's ID
    if (sessionId) {
      const userMsg = convertUserPromptToSDKMessage(
        message,
        userMessageId as UUID,
        images,
      );
      await addMessage({
        id: userMessageId, // Use frontend-generated ID for dedup
        conversationId: conversation.id,
        messageType: "user_prompt",
        sdkMessage: userMsg,
      });
    }

    for await (const sdkMessage of res.value) {

      // Partials: relay to subscribers but do not persist.
      if (sdkMessage.type === "stream_event") {
        streamEvents.emit("partial", conversation.id, sdkMessage);
        continue;
      }

      // The CLI's session state — the lifecycle authority. `running` (and
      // `requires_action`, a parked prompt inside a turn) = streaming.
      // `idle` = the turn and the CLI's own command queue are fully drained
      // (verified: it is NOT emitted between a turn's result and a queued
      // follow-up; it survives interrupt; a later push re-emits `running`).
      // The one thing the CLI cannot know about is a push still on stdin
      // that it has not parsed yet — that is what pendingUserMessageIds
      // guards: idle with un-acked pushes holds (its `running` follows in
      // milliseconds, watchdog otherwise). Not persisted.
      if (
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "session_state_changed"
      ) {
        if (sdkMessage.state === "idle") {
          stream.cliState = "idle";
          if (stream.pendingUserMessageIds.size === 0) {
            await settleIdle(conversation.id);
          } else {
            armIdleWatchdog(conversation.id, stream);
          }
        } else {
          stream.cliState = sdkMessage.state;
          stream.idleSettled = false;
          disarmIdleWatchdog(stream);
          await updateConversationStatus(conversation.id, "streaming");
          streamEvents.emit("streaming", conversation.id);
        }
        continue;
      }

      // Replay ack (--replay-user-messages): the CLI re-emits a stdin user
      // message once it is folded into a turn, carrying the uuid we stamped
      // — i.e. the userMessageId. This is acceptance. Relay it and do NOT
      // persist: the send-time user_prompt row is the single stored copy.
      // (Replays of messages we never pushed — CLI-internal reminders —
      // are likewise not persisted; they never were before the flag.)
      if (
        sdkMessage.type === "user" &&
        "isReplay" in sdkMessage &&
        sdkMessage.isReplay
      ) {
        stream.pendingUserMessageIds.delete(sdkMessage.uuid);
        streamEvents.emit("accepted", conversation.id, sdkMessage.uuid);
        continue;
      }

      // For NEW conversations: wait for init message to get session_id
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

        const userMsg = convertUserPromptToSDKMessage(
          message,
          userMessageId as UUID,
          images,
        );
        await addMessage({
          id: userMessageId, // Use frontend-generated ID for dedup
          conversationId: conversation.id,
          messageType: "user_prompt",
          sdkMessage: userMsg,
        });
      }

      // SDK messages use server-generated IDs
      await addMessage({
        conversationId: conversation.id,
        messageType: "sdk_message",
        sdkMessage,
      });

      // `result` is persisted like any other message but is NOT an
      // end-of-turn signal: a queued follow-up runs straight after it with
      // no idle in between. The CLI's `session_state_changed: idle` above
      // is the only thing that closes a turn.
    }

    // Reached only if the input stream is closed (end()) or the SDK tears
    // down. In the keep-alive model this is the absolute end of the
    // conversation, not a per-turn signal. We hold the slot from the claim
    // until the finally below, so this loop is unambiguously the owner and
    // reports unconditionally.
    await updateConversationStatus(conversation.id, "idle");
    streamEvents.emit("complete", conversation.id);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    streamEvents.emit("error", conversation.id, errorMessage);
    await updateConversationStatus(conversation.id, "error");
  } finally {
    unregisterStream(conversation.id);
  }
};

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

    // Mid-turn sends are accepted: processStream's claimStream() fork routes
    // them as pushes into the live stream, the CLI queues them, and the
    // replay ack (message_accepted) reports when each is folded into a
    // turn.
    //
    // No status write here. streamStatus has exactly one writer — the
    // owning loop, driven by the CLI's session state (`running` →
    // streaming, drained `idle` → idle). A second writer on the send path
    // is what let a send crossing the end of a turn leave the row idle
    // while the CLI ran the follow-up. The renderer covers the spawn window
    // with its optimistic state and subscribes on the 202.

    // Fire and forget - inner try/catch handles errors, this prevents unhandled rejections
    processStream(conversation, message, workspaceId, userMessageId, images, {
      model,
      effort,
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

// SSE endpoint for subscribing to stream events
api.get(
  "/chat/:conversationId/stream",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");

    // Validate conversation exists before opening stream
    const conversation = await getConversation(conversationId);
    if (conversation.isErr()) {
      const { status, code, message } = conversation.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return streamSSE(ctx, async (stream) => {
      // Seed the subscriber with the truth about the queue before any live
      // event can race it.
      stream.writeSSE({
        data: JSON.stringify({
          type: "queue_state",
          userMessageIds: [
            ...(activeStreams.get(conversationId)?.pendingUserMessageIds ?? []),
          ],
        } satisfies StreamEvent),
      });

      const onMessage = (convId: string, message: Message) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({
            type: "message",
            message,
          } satisfies StreamEvent),
        });
      };

      const onPartial = (
        convId: string,
        partial: SDKPartialAssistantMessage,
      ) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({
            type: "partial",
            partial,
          } satisfies StreamEvent),
        });
      };

      const onAccepted = (convId: string, userMessageId: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({
            type: "message_accepted",
            userMessageId,
          } satisfies StreamEvent),
        });
      };

      const onStreaming = (convId: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "streaming" } satisfies StreamEvent),
        });
      };

      const onComplete = (convId: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "complete" } satisfies StreamEvent),
        });
      };

      const onError = (convId: string, error: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "error", error } satisfies StreamEvent),
        });
      };

      const onEffort = (convId: string, level: string) => {
        if (convId !== conversationId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "effort", level } satisfies StreamEvent),
        });
      };

      streamEvents.on("message", onMessage);
      streamEvents.on("partial", onPartial);
      streamEvents.on("accepted", onAccepted);
      streamEvents.on("streaming", onStreaming);
      streamEvents.on("complete", onComplete);
      streamEvents.on("error", onError);
      streamEvents.on("effort", onEffort);

      ctx.req.raw.signal.addEventListener("abort", () => {
        streamEvents.off("message", onMessage);
        streamEvents.off("partial", onPartial);
        streamEvents.off("accepted", onAccepted);
        streamEvents.off("streaming", onStreaming);
        streamEvents.off("complete", onComplete);
        streamEvents.off("error", onError);
        streamEvents.off("effort", onEffort);
      });

      // Keep alive until client disconnects
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
// the authority on whether it was still queued: `cancelled: true` means it
// is dropped and will never run or be acked, so its user_prompt row goes
// too; `false` means it already folded into a turn (the ack has arrived or
// is imminent) or never reached the CLI — either way it runs, and the
// renderer just drops its "Queued" mark and waits for the ack.
api.delete(
  "/chat/:conversationId/message/:userMessageId",
  zValidator(
    "param",
    z.object({ conversationId: z.uuid(), userMessageId: z.uuid() }),
  ),
  async (ctx) => {
    const { conversationId, userMessageId } = ctx.req.valid("param");

    const cancelled = await cancelQueuedMessage(conversationId, userMessageId);
    if (!cancelled) {
      return ctx.json({ cancelled: false });
    }

    const deleted = await deleteMessage(userMessageId);
    if (deleted.isErr()) {
      // The CLI already dropped it; a stray row is the lesser evil. Log only.
      console.error("Failed to delete cancelled message row:", deleted.error);
    }

    // If the CLI is already idle and this was the last un-acked push, it
    // will say nothing more — close the turn.
    await settleIdle(conversationId);

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

// Mount the API under /api so the renderer can be served same-origin from
// antidraw://app/ and reach the API at antidraw://app/api/*. Same origin
// avoids CORS preflights and lets SSE/fetch behave like a normal web app.
export const app = new Hono();
app.route("/api", api);

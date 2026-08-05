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
export type { ClaudeAuthStatus } from "@/main/services/claude-cli-interactions.service";
export type { EffortLevel } from "./claude-code-ops";
export type {
  ComponentListItem,
  ComponentSource,
  ComponentStreamEvent,
} from "./services/component.service";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  sendMessage,
  generateTitle,
  buildPrompt,
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
  getConversation,
  getLastMainAssistantUuid,
  updateConversationOptions,
} from "./services/chat.service";
import {
  streamEvents,
  activeStreams,
  claimStream,
  attachQuery,
  unregisterStream,
  cancelStream as cancelActiveStream,
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
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Stream event types for SSE
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "partial"; partial: SDKPartialAssistantMessage }
  | { type: "complete" }
  | { type: "error"; error: string }
  // CLI's authoritative per-turn effort (after any silent downgrade).
  | { type: "effort"; level: string };

// Background processor for streaming messages
const processStream = async (
  conversation: Conversation,
  message: string,
  workspaceId: string,
  userMessageId: string,
  images?: ImageAttachment[],
) => {
  // Model/effort no longer travel with messages: the options endpoint
  // (PUT /chat/:conversationId/options) applies them to the live query at
  // selection time and persists them on the conversation row, which the
  // cold start below reads. Sends just send — under future message
  // queueing this stays latest-wins by construction.

  // Claim the conversation's stream slot. This single synchronous call is the
  // fork: win it and we cold-start and own the lifecycle below; lose it and a
  // stream is already live (or spawning), so this turn is a follow-up push.
  // Deciding both outcomes in one uninterruptible step is what stops two
  // concurrent sends from each cold-starting and clobbering the other.
  const promptStream = buildPrompt(message, images);
  const owned = claimStream(conversation.id, promptStream);

  // Push path. Persist the user message with the frontend-assigned id (dedup
  // contract) then push into the owner's input stream. This invocation owns NO
  // stream lifecycle, so it stays out of the try/finally below and never
  // unregisters — the owning loop picks up the pushed turn's SDK messages and
  // persists them.
  if (!owned) {
    const owner = activeStreams.get(conversation.id);
    try {
      const userMsg = convertUserPromptToSDKMessage(message, images);
      await addMessage({
        id: userMessageId,
        conversationId: conversation.id,
        messageType: "user_prompt",
        sdkMessage: userMsg,
      });
      // Enqueue is valid before the owner's CLI exists — the message waits in
      // the ReadableStream and is consumed once the query attaches.
      owner?.promptStream.push(message, images);
      if (owner?.query) trackMessageSent({ query: owner.query });
    } catch (e) {
      // Don't tear down the live stream or emit a terminal "error" — the
      // owning loop is still running. Just log; the failed push leaves the
      // optimistic message unconfirmed, which a refetch reconciles.
      console.error("Failed to push follow-up turn:", e);
    }
    return;
  }

  // Cold-start path: spawn a fresh query and own its lifecycle. The
  // try/finally below is scoped to THIS invocation's stream — the finally
  // unregisters only because we claimed above.
  try {
    const claudeCodeSessionID = conversation.claudeCodeSessionId ?? undefined;

    // Pin resume to the newest assistant message in OUR transcript so the
    // resumed model context matches exactly what the user sees (crash-orphaned
    // session-file tails become dead branches instead of hidden memory).
    let resumeSessionAt: string | undefined;
    if (claudeCodeSessionID) {
      const pin = await getLastMainAssistantUuid(conversation.id);
      if (pin.isOk()) resumeSessionAt = pin.value;
    }

    const res = sendMessage({
      promptStream,
      workspaceId,
      claudeCodeSessionID,
      model: conversation.selectedModel ?? undefined,
      effort: conversation.selectedEffort ?? undefined,
      resumeSessionAt,
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
      const userMsg = convertUserPromptToSDKMessage(message, images);
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

      // For NEW conversations: wait for init message to get session_id
      if (
        !sessionId &&
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "init"
      ) {
        sessionId = sdkMessage.session_id;
        await updateConversationSession(conversation.id, sessionId);

        const userMsg = convertUserPromptToSDKMessage(message, images);
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

      // End-of-turn: flip status back to idle so the next HTTP message
      // isn't rejected by the streaming gate, and notify subscribers so
      // the renderer clears its live partial / shimmer state. The
      // for-await loop continues, waiting for the next pushed turn.
      if (sdkMessage.type === "result") {
        await updateConversationStatus(conversation.id, "idle");
        streamEvents.emit("complete", conversation.id);
      }
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
    const { message, workspaceId, conversationId, userMessageId, images } =
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

    // Reject only when a turn is currently in flight. Stream liveness
    // (activeStreams entry) is intentionally not a gate — follow-up turns
    // push into the live stream via the existingStream branch in
    // processStream. streamStatus tracks per-turn state: it flips to
    // "streaming" here, back to "idle" when the SDK emits result.
    if (conversation.streamStatus === "streaming") {
      return ctx.json(
        {
          error: {
            code: "ALREADY_STREAMING",
            message: "Wait for current response",
          },
        },
        409,
      );
    }

    await updateConversationStatus(conversation.id, "streaming");

    // Fire and forget - inner try/catch handles errors, this prevents unhandled rejections
    processStream(conversation, message, workspaceId, userMessageId, images).catch(console.error);

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
      streamEvents.on("complete", onComplete);
      streamEvents.on("error", onError);
      streamEvents.on("effort", onEffort);

      ctx.req.raw.signal.addEventListener("abort", () => {
        streamEvents.off("message", onMessage);
        streamEvents.off("partial", onPartial);
        streamEvents.off("complete", onComplete);
        streamEvents.off("error", onError);
        streamEvents.off("effort", onEffort);
      });

      // Keep alive until client disconnects
      await new Promise(() => {});
    });
  },
);

const conversationOptionsSchema = z
  .object({
    model: z.string().min(1).optional(),
    effort: effortLevelSchema.optional(),
  })
  .refine((v) => v.model !== undefined || v.effort !== undefined, {
    message: "Provide model and/or effort",
  });

// Requested model/effort for a conversation. Decoupled from message sends so
// selection changes apply at click time (latest-wins under future queueing):
// persist on the row (cold starts read it), then apply to the live query via
// control requests. applyFlagSettings accepts "max" at runtime — the SDK's
// Settings.effortLevel type omits it, hence the cast.
api.put(
  "/chat/:conversationId/options",
  zValidator("param", z.object({ conversationId: z.uuid() })),
  zValidator("json", conversationOptionsSchema),
  async (ctx) => {
    const { conversationId } = ctx.req.valid("param");
    const { model, effort } = ctx.req.valid("json");

    const persisted = await updateConversationOptions(conversationId, {
      selectedModel: model,
      selectedEffort: effort,
    });
    if (persisted.isErr()) {
      const { status, code, message } = persisted.error;
      return ctx.json({ error: { code, message } }, status);
    }

    // No query means the slot is claimed but the CLI is still spawning. Skip
    // the live apply: that spawn reads the row we just persisted, so the
    // selection lands at start-up anyway.
    const query = activeStreams.get(conversationId)?.query;
    if (query) {
      try {
        // setModel(undefined) means "reset to default" — only call when set.
        if (model !== undefined) {
          await query.setModel(model);
        }
        if (effort !== undefined) {
          await query.applyFlagSettings({
            effortLevel: effort as Exclude<EffortLevel, "max">,
          });
        }
      } catch (e) {
        // Best-effort. The selection is already persisted above, so a failed
        // live apply just means it lands at the next cold start (spawn-time
        // options work on every CLI version) instead of mid-session.
        //
        // Nothing to tear down here. The two reachable causes both resolve
        // themselves: a dead process throws out of the iterator within ~10ms,
        // so the loop exits and its finally unregisters; a CLI too old for the
        // control subtype leaves a perfectly healthy stream that would be
        // pointless to discard. The UI needs no failure signal either way —
        // it renders from the init/assistant/Stop-hook echoes.
        console.error("Live option apply failed; applies next cold start:", e);
      }
    }

    return ctx.json({ ok: true });
  },
);

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

const createConversationSchema = z.object({
  workspaceId: z.uuid(),
  // Composer selection at creation time — becomes the conversation's
  // requested model/effort from its first message on.
  model: z.string().min(1).optional(),
  effort: effortLevelSchema.optional(),
});

api.post(
  "/chat/conversation",
  zValidator("json", createConversationSchema),
  async (ctx) => {
    const { workspaceId, model, effort } = ctx.req.valid("json");
    const result = await createConversation(workspaceId, {
      selectedModel: model,
      selectedEffort: effort,
    });

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

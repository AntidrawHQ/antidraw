import { EventEmitter } from "events";
import type {
  Message,
  StreamStatus,
} from "@/main/api/models/chat.model";
import type {
  Query,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PromptStream } from "../api/claude-code-ops";

/**
 * Everything a renderer can learn about a conversation's stream, on one
 * channel. The SSE route relays these one-for-one; the renderer mirrors them
 * into its cache. On subscribe the route first sends the current `status`
 * and `queue_state`, so a (re)connecting renderer starts from the truth.
 */
export type StreamEvent =
  // A persisted row (user prompt or SDK message). Dedup by id.
  | { type: "message"; message: Message }
  // Partial assistant output; never persisted.
  | { type: "partial"; partial: SDKPartialAssistantMessage }
  // Mirror of the CLI's session state: "streaming" on `running`, "idle" when
  // the CLI says its turn AND its command queue are drained.
  | { type: "status"; status: StreamStatus }
  // Full snapshot of mid-turn sends the CLI has not yet folded into a turn.
  // Sent whenever it changes and on subscribe. Drives the "Queued" marks.
  | { type: "queue_state"; userMessageIds: string[] };

type ConversationEvents = {
  event: [conversationId: string, event: StreamEvent];
};

export const streamEvents = new EventEmitter<ConversationEvents>();

export const emitStreamEvent = (
  conversationId: string,
  event: StreamEvent
): void => {
  streamEvents.emit("event", conversationId, event);
};

export type ActiveStream = {
  // null only between the claim and the spawn: the slot is taken before the
  // CLI exists so no second send can claim it, and callers that need the
  // query skip that window.
  query: Query | null;
  promptStream: PromptStream;
  // Mid-turn sends pushed to the CLI and not yet acked by its replay.
  // Mutate only via markPending / clearPending so the renderer is told.
  pendingUserMessageIds: Set<string>;
  // Mirror of the CLI's last session_state_changed: true only after it
  // reported `idle`. false from the claim (a turn is about to run) and on
  // `running`.
  idle: boolean;
};

export const activeStreams = new Map<string, ActiveStream>();

/**
 * The live stream status of a conversation, derived — never stored. A stream
 * is a child process: it cannot outlive us, so there is nothing to persist
 * and nothing to reset on boot. Streaming iff a stream exists and the CLI
 * has not reported idle.
 */
export const getStreamStatus = (conversationId: string): StreamStatus => {
  const stream = activeStreams.get(conversationId);
  return stream && !stream.idle ? "streaming" : "idle";
};

export const queueSnapshot = (conversationId: string): string[] => [
  ...(activeStreams.get(conversationId)?.pendingUserMessageIds ?? []),
];

const broadcastQueue = (conversationId: string): void => {
  emitStreamEvent(conversationId, {
    type: "queue_state",
    userMessageIds: queueSnapshot(conversationId),
  });
};

export const markPending = (
  conversationId: string,
  userMessageId: string
): void => {
  activeStreams.get(conversationId)?.pendingUserMessageIds.add(userMessageId);
  broadcastQueue(conversationId);
};

export const clearPending = (
  conversationId: string,
  userMessageId: string
): void => {
  activeStreams.get(conversationId)?.pendingUserMessageIds.delete(userMessageId);
  broadcastQueue(conversationId);
};

export const clearAllPending = (conversationId: string): void => {
  activeStreams.get(conversationId)?.pendingUserMessageIds.clear();
  broadcastQueue(conversationId);
};

/**
 * Take the conversation's stream slot, synchronously.
 *
 * This is the send path's fork: the winner cold-starts and owns the
 * lifecycle, anyone who loses is a follow-up turn and pushes into the
 * winner's promptStream instead. Nothing awaits between the get() and the
 * set(), so two concurrent sends cannot both win — this map is the only
 * place that can serialise in-process work, and the status the UI sees is
 * derived from it (getStreamStatus).
 *
 * The claim carries the promptStream because buildPrompt() is synchronous and
 * pushing is an enqueue — so a loser can push immediately, before the winner's
 * CLI has even spawned. Its message queues in the ReadableStream and is
 * consumed once the query attaches. Nothing is rejected or lost.
 */
export const claimStream = (
  conversationId: string,
  promptStream: PromptStream
): { owned: boolean; stream: ActiveStream } => {
  const existing = activeStreams.get(conversationId);
  if (existing) return { owned: false, stream: existing };
  const stream: ActiveStream = {
    query: null,
    promptStream,
    pendingUserMessageIds: new Set(),
    idle: false,
  };
  activeStreams.set(conversationId, stream);
  return { owned: true, stream };
};

// Interrupt ONLY. interrupt() is a control request that aborts the in-flight
// turn — the CLI process, the query and the input stream all survive it, so
// the session stays usable for follow-up turns. Queued messages survive it
// too and run as the next turn (verified).
export const cancelStream = async (conversationId: string): Promise<boolean> => {
  const stream = activeStreams.get(conversationId);
  // No query yet = the CLI is still spawning, so there is no turn to abort.
  if (!stream?.query) return false;
  await stream.query.interrupt();
  return true;
};

// cancelAsyncMessage is a real control request on the SDK's Query (subtype
// "cancel_async_message"; returns the CLI's `cancelled` boolean) but is not
// declared on the public Query interface in 0.3.201 — narrow here, once.
type QueryWithCancelAsyncMessage = Query & {
  cancelAsyncMessage?: (messageUuid: string) => Promise<boolean>;
};

// Withdraw a pushed-but-not-yet-accepted message from the CLI's queue.
// Returns the CLI's own verdict: true = it was still queued and is now
// dropped (it will never run and never be acked); false = already folded
// into a turn (its ack has arrived or is about to), or never reached the CLI
// (no query yet: the message sits in the ReadableStream buffer during the
// spawn window — it will simply run).
export const cancelQueuedMessage = async (
  conversationId: string,
  userMessageId: string
): Promise<boolean> => {
  const stream = activeStreams.get(conversationId);
  const query = stream?.query as QueryWithCancelAsyncMessage | null | undefined;
  if (!stream || !query?.cancelAsyncMessage) return false;
  const cancelled = await query.cancelAsyncMessage(userMessageId);
  if (cancelled) clearPending(conversationId, userMessageId);
  return cancelled;
};

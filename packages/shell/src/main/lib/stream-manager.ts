import { EventEmitter } from "events";
import type { Message, StreamStatus } from "@/main/api/models/chat.model";
import type {
  Query,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PromptStream } from "../api/claude-code-ops";

type ConversationEvents = {
  message: [conversationId: string, message: Message];
  partial: [conversationId: string, partial: SDKPartialAssistantMessage];
  // The CLI folded a pushed user message into a turn (replay ack carrying
  // the userMessageId we stamped at push time). Until this fires the
  // message is "queued" from the UI's perspective.
  accepted: [conversationId: string, userMessageId: string];
  // The CLI reported session state `running`: a turn is in flight (or about
  // to be). The renderer flips to streaming on this — it is the push-side
  // counterpart of `complete`, and the only other status writer.
  streaming: [conversationId: string];
  complete: [conversationId: string];
  error: [conversationId: string, error: string];
  // Actual effort the CLI ran the turn with (Stop-hook echo, post any
  // silent downgrade). Transport only for now — nothing consumes it; kept
  // wired for future deviation-from-selection product feedback.
  effort: [conversationId: string, level: string];
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

// No model/effort here on purpose: the Query exposes no readback and caching
// them only saves a ~1-5ms no-op control request per send (verified — the CLI
// re-emits init per turn regardless). There is nothing to cache anyway:
// options ride each send from the composer, so cold starts pass them as
// spawn options and pushes apply them via control requests first.
// The CLI's own session state, as reported by its `session_state_changed`
// events (enabled via CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS at spawn).
// "spawning" is ours: the process exists but has not reported yet.
//   running          — a turn is in flight (emitted before the first init)
//   requires_action  — parked on a permission/dialog prompt (still a turn)
//   idle             — the turn AND the CLI's command queue are fully
//                      drained; nothing more will arrive until a push
export type CliSessionState = "spawning" | "running" | "requires_action" | "idle";

export type ActiveStream = {
  // null only between the claim and the spawn: the slot is taken before the
  // CLI exists so no second send can claim it, and callers that need the
  // query skip that window. It spans exactly one await on every send — the
  // options snapshot persist — since sendMessage() itself is synchronous.
  query: Query | null;
  promptStream: PromptStream;
  // Follow-up (push-path) userMessageIds not yet acked by a replay. Serves
  // three things: the renderer's "Queued" marks, cancel, and one guard —
  // a CLI `idle` that lands while a push is still in flight on stdin (the
  // CLI has not parsed it yet, so its queue looked empty) must not close
  // the turn; the `running` for that push follows within milliseconds.
  // Added BEFORE push (the ack arrives asynchronously via the loop),
  // removed on ack or on a successful cancel. Verified live: `idle` is not
  // emitted between a turn's result and a queued follow-up the CLI already
  // holds — only when its queue is truly empty.
  pendingUserMessageIds: Set<string>;
  // Last state the CLI reported. The owning loop is the only writer.
  cliState: CliSessionState;
  // True once the current `idle` has been turned into status idle +
  // `complete`. Reset on `running`. Lets the idle guard above be released
  // later (ack, cancel, watchdog) without double-completing.
  idleSettled: boolean;
  // Safety net for the idle guard: if `idle` arrived with a push in flight
  // and no `running` follows (the push was lost), release the hold.
  idleWatchdog: ReturnType<typeof setTimeout> | null;
};

// cancelAsyncMessage is a real control request on the SDK's Query (subtype
// "cancel_async_message"; returns the CLI's `cancelled` boolean) but is not
// declared on the public Query interface in 0.3.201 — narrow here, once.
type QueryWithCancelAsyncMessage = Query & {
  cancelAsyncMessage?: (messageUuid: string) => Promise<boolean>;
};

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, ActiveStream>();

// Conversations whose last owning loop died (CLI crash, spawn failure).
// Cleared the moment a new stream is claimed for them. Lets a fresh load
// still see "error" until the user sends again — that is the only thing
// "error" was ever used for.
const erroredStreams = new Set<string>();

export const markStreamError = (conversationId: string): void => {
  erroredStreams.add(conversationId);
};

/**
 * The live stream status of a conversation, derived — never stored. A stream
 * is a child process: it cannot outlive us, so there is nothing to persist
 * and nothing to reset on boot. No active stream = idle (or error if the
 * last one died); active stream = whatever the CLI last reported, with
 * "spawning" counted as streaming because a turn is about to run.
 */
export const getStreamStatus = (conversationId: string): StreamStatus => {
  const stream = activeStreams.get(conversationId);
  if (!stream) return erroredStreams.has(conversationId) ? "error" : "idle";
  return stream.cliState === "idle" ? "idle" : "streaming";
};

/**
 * Take the conversation's stream slot, synchronously.
 *
 * This is the send path's fork: the winner cold-starts and owns the
 * lifecycle, anyone who loses is a follow-up turn and pushes into the
 * winner's promptStream instead. Both outcomes are decided here so the
 * decision cannot be raced.
 *
 * Nothing awaits between the has() and the set(), so two concurrent sends
 * cannot both win. That is the whole point: this map is the only place that
 * can serialise in-process work — it decides who owns the stream, and the
 * status the UI sees is derived from it (getStreamStatus).
 *
 * The claim carries the promptStream because buildPrompt() is synchronous and
 * pushing is an enqueue — so a loser can push immediately, before the winner's
 * CLI has even spawned. Its message queues in the ReadableStream and is
 * consumed once the query attaches. Nothing is rejected or lost.
 */
export const claimStream = (
  conversationId: string,
  promptStream: PromptStream
): boolean => {
  if (activeStreams.has(conversationId)) return false;
  erroredStreams.delete(conversationId);
  activeStreams.set(conversationId, {
    query: null,
    promptStream,
    pendingUserMessageIds: new Set(),
    cliState: "spawning",
    idleSettled: false,
    idleWatchdog: null,
  });
  return true;
};

// Fills in the query once the CLI has spawned. The slot is already ours.
export const attachQuery = (conversationId: string, query: Query): void => {
  const stream = activeStreams.get(conversationId);
  if (stream) stream.query = query;
};

// Only the owning loop's finally calls this, and only after its for-await has
// terminated — so an entry can never vanish under a live loop. That single
// writer is what lets the send path trust whatever claimStream tells it.
export const unregisterStream = (conversationId: string): void => {
  const stream = activeStreams.get(conversationId);
  if (stream?.idleWatchdog) clearTimeout(stream.idleWatchdog);
  activeStreams.delete(conversationId);
};

// Interrupt ONLY. interrupt() is a control request that aborts the in-flight
// turn — the CLI process, the query and the input stream all survive it, so
// the session stays usable for follow-up turns (verified: a turn pushed after
// an interrupt is answered on the same session id).
//
// Deleting the entry here used to strand that survivor: nothing closes the
// input stream, so the owning loop's `for await` never ends, its finally never
// runs, and the process stays alive with no handle left to reach it — one
// leaked CLI per stop click. Leaving the entry in place keeps the loop the
// owner, lets the interrupt's `result` message flow through the normal
// end-of-turn path, and lets the next send push into the live session.
export const cancelStream = async (conversationId: string): Promise<boolean> => {
  const stream = activeStreams.get(conversationId);
  // No query yet = the CLI is still spawning, so there is no turn to abort.
  if (!stream?.query) return false;
  await stream.query.interrupt();
  return true;
};

// Withdraw a pushed-but-not-yet-accepted message from the CLI's queue.
// Returns the CLI's own verdict: true = it was still queued and is now
// dropped (it will never run and never be acked); false = already folded
// into a turn (its ack has arrived or is about to), or never reached the CLI
// (no query yet: the message sits in the ReadableStream buffer during the
// spawn window — not worth reaching into, it will simply run). On true the
// uuid leaves the pending set here; the caller settles any held turn.
export const cancelQueuedMessage = async (
  conversationId: string,
  userMessageId: string
): Promise<boolean> => {
  const stream = activeStreams.get(conversationId);
  const query = stream?.query as QueryWithCancelAsyncMessage | null | undefined;
  if (!stream || !query?.cancelAsyncMessage) return false;
  const cancelled = await query.cancelAsyncMessage(userMessageId);
  if (cancelled) stream.pendingUserMessageIds.delete(userMessageId);
  return cancelled;
};

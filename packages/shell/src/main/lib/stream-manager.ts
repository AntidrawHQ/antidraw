import { EventEmitter } from "events";
import type { Message } from "@/main/api/models/chat.model";
import type {
  Query,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PromptStream } from "../api/claude-code-ops";

type ConversationEvents = {
  message: [conversationId: string, message: Message];
  partial: [conversationId: string, partial: SDKPartialAssistantMessage];
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
export type ActiveStream = {
  // null only between the claim and the spawn: the slot is taken before the
  // CLI exists so no second send can claim it, and callers that need the
  // query skip that window. It spans exactly one await on every send — the
  // options snapshot persist — since sendMessage() itself is synchronous.
  query: Query | null;
  promptStream: PromptStream;
};

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, ActiveStream>();

/**
 * Take the conversation's stream slot, synchronously.
 *
 * This is the send path's fork: the winner cold-starts and owns the
 * lifecycle, anyone who loses is a follow-up turn and pushes into the
 * winner's promptStream instead. Both outcomes are decided here so the
 * decision cannot be raced.
 *
 * Nothing awaits between the has() and the set(), so two concurrent sends
 * cannot both win. That is the whole point: streamStatus lives in SQLite, so
 * the 409 gate in POST /chat/message reads a snapshot fetched one round trip
 * ago and cannot serialise in-process work. The DB status drives the UI; this
 * map decides who owns the stream.
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
  activeStreams.set(conversationId, { query: null, promptStream });
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

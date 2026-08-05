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
  // Actual effort level for the turn, echoed by the CLI via a Stop hook —
  // includes any silent downgrade the CLI applied for the selected model.
  effort: [conversationId: string, level: string];
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

// No model/effort here on purpose: the Query exposes no readback and caching
// them only saves a ~1-5ms no-op control request per send (verified — the CLI
// re-emits init per turn regardless). processStream applies the requested
// options unconditionally before each push instead.
export type ActiveStream = {
  query: Query;
  promptStream: PromptStream;
};

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, ActiveStream>();

export const registerStream = (
  conversationId: string,
  stream: ActiveStream
): void => {
  activeStreams.set(conversationId, stream);
};

// promptStream identifies the caller's stream: a superseded loop's cleanup
// must not delete the replacement entry another loop has registered since.
export const unregisterStream = (
  conversationId: string,
  promptStream?: PromptStream
): void => {
  if (
    promptStream &&
    activeStreams.get(conversationId)?.promptStream !== promptStream
  ) {
    return;
  }
  activeStreams.delete(conversationId);
};

export const isStreamOwner = (
  conversationId: string,
  promptStream: PromptStream
): boolean => activeStreams.get(conversationId)?.promptStream === promptStream;

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
  if (!stream) return false;
  await stream.query.interrupt();
  return true;
};

export const isStreamActive = (conversationId: string): boolean => {
  return activeStreams.has(conversationId);
};

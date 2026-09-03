import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { StreamStatus } from "@/main/api/models/chat.model";
import type { PromptStream } from "@/main/api/claude-code-ops";
import type { CliHandle, CliSessionState, TurnType } from "./types";
import {
  foldPartial,
  type LivePartial,
} from "@/shared/utils/live-partial";
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { conversationEvents } from "./events";

const handles = new Map<string, CliHandle>();
const errored = new Set<string>();

export const getHandle = (
  conversationId: string,
): CliHandle | undefined => handles.get(conversationId);

export const openHandle = (
  conversationId: string,
  promptStream: PromptStream,
): TurnType => {
  if (handles.has(conversationId)) return "follow-up";
  errored.delete(conversationId);
  handles.set(conversationId, {
    conversationId,
    query: null,
    promptStream,
    cliState: "spawning",
    pendingUserMessageIds: new Set(),
    partial: null,
  });
  return "cold-start";
};

export const attachQuery = (conversationId: string, query: Query): void => {
  const handle = handles.get(conversationId);
  if (handle) handle.query = query;
};

export const releaseHandle = (conversationId: string): void => {
  handles.delete(conversationId);
};

export const markError = (conversationId: string): void => {
  errored.add(conversationId);
};

export const getStreamStatus = (conversationId: string): StreamStatus => {
  const handle = handles.get(conversationId);
  if (!handle) return errored.has(conversationId) ? "error" : "idle";
  return handle.cliState === "idle" ? "idle" : "streaming";
};

// The CLI's own session state, for seeding a subscriber. No handle means no
// CLI, which is exactly what "idle" reports — the same collapse getStreamStatus
// makes, kept in the CLI's vocabulary because that is what the `state` event
// carries.
export const getCliState = (conversationId: string): CliSessionState =>
  handles.get(conversationId)?.cliState ?? "idle";

// The in-flight content block, kept so a subscriber that connects mid-block
// can be handed the text so far instead of a gap that only fills on the next
// delta. The renderer folds the same deltas from the same helper.
export const getPartial = (conversationId: string): LivePartial | null =>
  handles.get(conversationId)?.partial ?? null;

export const applyPartial = (
  conversationId: string,
  partial: SDKPartialAssistantMessage,
): void => {
  const handle = handles.get(conversationId);
  if (!handle) return;
  handle.partial = foldPartial(handle.partial, partial.event);
};

export const clearPartial = (conversationId: string): void => {
  const handle = handles.get(conversationId);
  if (handle) handle.partial = null;
};

export const setCliState = (
  conversationId: string,
  cliState: CliSessionState,
): void => {
  const handle = handles.get(conversationId);
  if (!handle || handle.cliState === cliState) return;
  handle.cliState = cliState;
  // No turn in flight means no in-flight block. Dropping it here keeps a
  // stale block from being seeded to whoever subscribes next.
  if (cliState === "idle") handle.partial = null;
  conversationEvents.emit("state", conversationId, { state: cliState });
};

const emitQueue = (handle: CliHandle): void => {
  conversationEvents.emit("queue", handle.conversationId, {
    userMessageIds: [...handle.pendingUserMessageIds],
  });
};

export const getPending = (conversationId: string): string[] => [
  ...(handles.get(conversationId)?.pendingUserMessageIds ?? []),
];

export const addPending = (
  conversationId: string,
  userMessageId: string,
): void => {
  const handle = handles.get(conversationId);
  if (!handle || handle.pendingUserMessageIds.has(userMessageId)) return;
  handle.pendingUserMessageIds.add(userMessageId);
  emitQueue(handle);
};

export const resolvePending = (
  conversationId: string,
  userMessageId: string,
): boolean => {
  const handle = handles.get(conversationId);
  if (!handle?.pendingUserMessageIds.delete(userMessageId)) return false;
  emitQueue(handle);
  return true;
};

export const clearPending = (conversationId: string): void => {
  const handle = handles.get(conversationId);
  if (!handle || handle.pendingUserMessageIds.size === 0) return;
  handle.pendingUserMessageIds.clear();
  emitQueue(handle);
};

// cancelAsyncMessage is a real control request on the SDK's Query (subtype
// "cancel_async_message") but is not declared on the public Query interface
// in 0.3.201 — narrow here, once.
type QueryWithCancelAsyncMessage = Query & {
  cancelAsyncMessage?: (messageUuid: string) => Promise<boolean>;
};

// A control request is a write to the CLI's stdin plus a wait for the matching
// response. The SDK bounds the wait itself: a failed write rejects at once,
// and when the process exits it rejects every request still pending. What it
// does not bound is a CLI that is alive and simply slow to answer — and that
// is deliberate here too. An interrupt can legitimately take a while to
// settle, and a cancel answered after we gave up would leave the CLI's verdict
// applied on its side and unknown on ours. So: no timeout, but the rejection
// is caught, because letting it escape turns a dead CLI into an unhandled 500
// on a route that already has a word for "could not do it".
const controlRequestFailed = (what: string, e: unknown): false => {
  console.error(`${what} control request failed:`, e);
  return false;
};

// Aborts the in-flight turn. The process, the query and the pipe all survive,
// so the handle deliberately stays open — releasing it here would strand a
// live CLI with nothing left to reach it by.
export const interrupt = async (conversationId: string): Promise<boolean> => {
  const handle = handles.get(conversationId);
  if (!handle?.query) return false;
  try {
    await handle.query.interrupt();
  } catch (e) {
    return controlRequestFailed("interrupt", e);
  }
  return true;
};

export const cancelQueued = async (
  conversationId: string,
  userMessageId: string,
): Promise<boolean> => {
  const handle = handles.get(conversationId);
  const query = handle?.query as QueryWithCancelAsyncMessage | undefined;
  if (!query?.cancelAsyncMessage) return false;
  let cancelled: boolean;
  try {
    cancelled = await query.cancelAsyncMessage(userMessageId);
  } catch (e) {
    // False is the endpoint's existing answer for "the CLI did not withdraw
    // it": the bubble stays, only the mark drops. Whether the message runs is
    // now the loop's to report — a dead CLI clears pending on its way out.
    return controlRequestFailed("cancel_async_message", e);
  }
  if (cancelled) resolvePending(conversationId, userMessageId);
  return cancelled;
};

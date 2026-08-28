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

// Aborts the in-flight turn. The process, the query and the pipe all survive,
// so the handle deliberately stays open — releasing it here would strand a
// live CLI with nothing left to reach it by.
export const interrupt = async (conversationId: string): Promise<boolean> => {
  const handle = handles.get(conversationId);
  if (!handle?.query) return false;
  await handle.query.interrupt();
  return true;
};

export const cancelQueued = async (
  conversationId: string,
  userMessageId: string,
): Promise<boolean> => {
  const handle = handles.get(conversationId);
  const query = handle?.query as QueryWithCancelAsyncMessage | undefined;
  if (!query?.cancelAsyncMessage) return false;
  const cancelled = await query.cancelAsyncMessage(userMessageId);
  if (cancelled) resolvePending(conversationId, userMessageId);
  return cancelled;
};

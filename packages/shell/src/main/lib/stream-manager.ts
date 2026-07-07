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
  accepted: [conversationId: string, userMessageId: string];
  complete: [conversationId: string];
  error: [conversationId: string, error: string];
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

export type ActiveStream = {
  query: Query;
  promptStream: PromptStream;
  // userMessageIds pushed to the CLI but not yet acked by a replay. Non-empty
  // at result time means the CLI is about to start another turn for a message
  // that landed after the current turn finalized — don't flip to idle.
  pendingUserMessageIds: Set<string>;
};

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, ActiveStream>();

export const registerStream = (conversationId: string, query: Query, promptStream: PromptStream): ActiveStream => {
  const stream: ActiveStream = { query, promptStream, pendingUserMessageIds: new Set() };
  activeStreams.set(conversationId, stream);
  return stream;
};

export const unregisterStream = (conversationId: string): void => {
  activeStreams.delete(conversationId);
};

export const cancelStream = async (conversationId: string): Promise<boolean> => {
  const stream = activeStreams.get(conversationId);
  if (stream) {
    await stream.query.interrupt();
    activeStreams.delete(conversationId); // Clean up immediately after interrupt
    return true;
  }
  return false;
};

export const isStreamActive = (conversationId: string): boolean => {
  return activeStreams.has(conversationId);
};

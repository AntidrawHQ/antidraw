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
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, {
  query: Query;
  promptStream: PromptStream;
}>();

export const registerStream = (conversationId: string, query: Query, promptStream: PromptStream): void => {
  activeStreams.set(conversationId, { query, promptStream });
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

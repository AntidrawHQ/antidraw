import { EventEmitter } from "events";
import type { Message } from "@/main/api/models/chat.model";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

type ConversationEvents = {
  message: [conversationId: string, message: Message];
  complete: [conversationId: string];
  error: [conversationId: string, error: string];
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, Query>();

export const registerStream = (conversationId: string, query: Query): void => {
  activeStreams.set(conversationId, query);
};

export const unregisterStream = (conversationId: string): void => {
  activeStreams.delete(conversationId);
};

export const cancelStream = async (conversationId: string): Promise<boolean> => {
  const query = activeStreams.get(conversationId);
  if (query) {
    await query.interrupt();
    activeStreams.delete(conversationId); // Clean up immediately after interrupt
    return true;
  }
  return false;
};

export const isStreamActive = (conversationId: string): boolean => {
  return activeStreams.has(conversationId);
};

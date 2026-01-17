import { EventEmitter } from "events";
import type { Message } from "@/main/api/models/chat.model";

type ConversationEvents = {
  message: [conversationId: string, message: Message];
  complete: [conversationId: string];
  error: [conversationId: string, error: string];
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

// Simple exports - no wrapper object
export const streamEvents = new ConversationEventEmitter();
export const activeStreams = new Map<string, AbortController>();

export const registerStream = (conversationId: string): AbortController => {
  const controller = new AbortController();
  activeStreams.set(conversationId, controller);
  return controller;
};

export const unregisterStream = (conversationId: string): void => {
  activeStreams.delete(conversationId);
};

export const cancelStream = (conversationId: string): boolean => {
  const controller = activeStreams.get(conversationId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
};

export const isStreamActive = (conversationId: string): boolean => {
  return activeStreams.has(conversationId);
};

import type { QueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";
import { subscribeToConversation, type StreamEvent } from "./api";

const activeSubscriptions = new Map<string, Promise<void>>();

export const subscribeToStream = (
  conversationId: string,
  queryClient: QueryClient,
): void => {
  // Already subscribed - no-op
  if (activeSubscriptions.has(conversationId)) return;

  const promise = (async () => {
    try {
      const stream = subscribeToConversation(conversationId);

      for await (const event of stream) {
        handleStreamEvent(conversationId, event, queryClient);
      }
    } catch (e) {
      console.error("Stream subscription error:", e);
    } finally {
      activeSubscriptions.delete(conversationId);
    }
  })();

  activeSubscriptions.set(conversationId, promise);
};

export const isSubscribed = (conversationId: string): boolean => {
  return activeSubscriptions.has(conversationId);
};

const handleStreamEvent = (
  conversationId: string,
  event: StreamEvent,
  queryClient: QueryClient,
): void => {
  if (event.type === "message") {
    queryClient.setQueryData<ConversationWithMessages>(
      ["conversation", conversationId],
      (old) => {
        if (!old) return old;
        // Dedup by ID
        if (old.messages.some((m) => m.id === event.message.id)) return old;
        return { ...old, messages: [...old.messages, event.message] };
      },
    );
  }

  if (event.type === "complete") {
    queryClient.setQueryData<ConversationWithMessages>(
      ["conversation", conversationId],
      (old) => (old ? { ...old, streamStatus: "completed" } : old),
    );
  }

  if (event.type === "error") {
    queryClient.setQueryData<ConversationWithMessages>(
      ["conversation", conversationId],
      (old) => (old ? { ...old, streamStatus: "error" } : old),
    );
  }
};

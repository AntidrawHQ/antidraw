import type { QueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages";
import { subscribeToConversation, type StreamEvent } from "./api";
import { queryKeys } from "./query-keys";
import { parsePartialJson } from "@/shared/utils/parse-partial-json";

const activeSubscriptions = new Map<string, Promise<void>>();

// The in-flight content block — stored as the SDK's own BetaContentBlock,
// with `partialJson` as a sibling string accumulator for tool_use blocks
// (the SDK doesn't expose this — it parses internally on content_block_stop).
export type LivePartial = {
  index: number;
  block: BetaContentBlock;
  partialJson?: string;
} | null;

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

const clearLive = (conversationId: string, queryClient: QueryClient): void => {
  queryClient.setQueryData<LivePartial>(
    queryKeys.conversations.livePartial(conversationId),
    null,
  );
};

const handleStreamEvent = (
  conversationId: string,
  event: StreamEvent,
  queryClient: QueryClient,
): void => {
  if (event.type === "partial") {
    const raw = event.partial.event;

    // Only content_block_start and content_block_delta mutate live state.
    // message_start/delta/stop and content_block_stop are ignored:
    // - content_block_stop is redundant; persisted assistant messages clear live state.
    // - message_* events carry no per-block info we render.
    if (
      raw.type !== "content_block_start" &&
      raw.type !== "content_block_delta"
    ) {
      return;
    }

    queryClient.setQueryData<LivePartial>(
      queryKeys.conversations.livePartial(conversationId),
      (prev) => {
        // SEED: store the SDK's content_block as-is; init partialJson only for tool_use.
        if (raw.type === "content_block_start") {
          return {
            index: raw.index,
            block: raw.content_block as BetaContentBlock,
            partialJson:
              raw.content_block.type === "tool_use" ? "" : undefined,
          };
        }

        // APPEND: mutate the single in-flight block.
        if (!prev || prev.index !== raw.index) return prev;
        const b = prev.block;
        const delta = raw.delta;

        if (delta.type === "text_delta" && b.type === "text") {
          return { ...prev, block: { ...b, text: b.text + delta.text } };
        }
        if (delta.type === "thinking_delta" && b.type === "thinking") {
          return {
            ...prev,
            block: { ...b, thinking: b.thinking + delta.thinking },
          };
        }
        if (delta.type === "input_json_delta" && b.type === "tool_use") {
          const partialJson = (prev.partialJson ?? "") + delta.partial_json;
          const parsed = parsePartialJson(partialJson);
          return {
            ...prev,
            partialJson,
            block: { ...b, input: parsed ?? b.input },
          };
        }
        // signature_delta and any unknown delta: ignored
        return prev;
      },
    );
    return;
  }

  if (event.type === "message") {
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => {
        if (!old) return old;
        // Dedup by ID
        if (old.messages.some((m) => m.id === event.message.id)) return old;
        return { ...old, messages: [...old.messages, event.message] };
      },
    );

    // Any persisted assistant message means the in-flight block just finalized.
    // Blocks stream serially, so we don't need to match — there's only one to clear.
    if (event.message.sdkMessage.type === "assistant") {
      clearLive(conversationId, queryClient);
    }
    return;
  }

  if (event.type === "complete") {
    clearLive(conversationId, queryClient);
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => (old ? { ...old, streamStatus: "idle" } : old),
    );
    // TODO: Rearchitect to a single stream endpoint that sends initial state + live events,
    // eliminating the race condition between initial fetch and stream subscription.
    queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.detail(conversationId),
    });
    return;
  }

  if (event.type === "error") {
    clearLive(conversationId, queryClient);
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => (old ? { ...old, streamStatus: "error" } : old),
    );
    queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.detail(conversationId),
    });
    return;
  }

  if (event.type === "effort") {
    // Actual per-turn effort echoed by the CLI (post any silent downgrade).
    // Deliberately unconsumed: the picker shows the user's selection, not
    // CLI state. Reserved for product feedback when the actual effort
    // deviates from the selection — compare against the sent effort here
    // when that lands.
    return;
  }
};

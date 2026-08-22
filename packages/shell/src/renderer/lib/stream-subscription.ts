import type { QueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages";
import { subscribeToConversation, type StreamEvent } from "./api";
import { queryKeys } from "./query-keys";

// Mutation key of useSendMessage — referenced here so queue_state can spare
// the marks of sends whose POST is still in flight (the backend cannot know
// about those yet).
export const SEND_MESSAGE_MUTATION_KEY = "send-message";
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

const clearQueued = (
  conversationId: string,
  queryClient: QueryClient,
): void => {
  queryClient.setQueryData<string[]>(
    queryKeys.conversations.queuedMessageIds(conversationId),
    [],
  );
};

const inFlightSendIds = (queryClient: QueryClient): string[] =>
  queryClient
    .getMutationCache()
    .getAll()
    .filter(
      (m) =>
        m.options.mutationKey?.[0] === SEND_MESSAGE_MUTATION_KEY &&
        m.state.status === "pending",
    )
    .map((m) => (m.state.variables as { userMessageId?: string })?.userMessageId)
    .filter((id): id is string => typeof id === "string");

const handleStreamEvent = (
  conversationId: string,
  event: StreamEvent,
  queryClient: QueryClient,
): void => {
  // Authoritative queue snapshot on (re)subscribe: rebuild the marks from
  // it, keeping only the sends the backend cannot know about yet.
  if (event.type === "queue_state") {
    const inFlight = inFlightSendIds(queryClient);
    queryClient.setQueryData<string[]>(
      queryKeys.conversations.queuedMessageIds(conversationId),
      (prev) => [
        ...event.userMessageIds,
        ...(prev ?? []).filter(
          (id) => inFlight.includes(id) && !event.userMessageIds.includes(id),
        ),
      ],
    );
    return;
  }

  // The CLI reported a turn in flight. The only thing that can have made
  // the cache say otherwise is a refetch that raced the CLI's own report
  // (the backend writes the row on `running`, not on send), so re-assert.
  if (event.type === "streaming") {
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => (old ? { ...old, streamStatus: "streaming" } : old),
    );
    return;
  }

  // The CLI folded a mid-turn send into a turn — it is no longer "queued".
  if (event.type === "message_accepted") {
    queryClient.setQueryData<string[]>(
      queryKeys.conversations.queuedMessageIds(conversationId),
      (prev) => prev?.filter((id) => id !== event.userMessageId) ?? [],
    );
    return;
  }

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
    // A turn can only complete with nothing left un-acked (the backend holds
    // the turn open otherwise), so any leftover mark is stale.
    clearQueued(conversationId, queryClient);
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
    clearQueued(conversationId, queryClient);
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

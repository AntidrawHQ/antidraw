import type { QueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";
import { subscribeToConversation, type StreamEvent } from "./api";
import { queryKeys } from "./query-keys";

export const SEND_MESSAGE_MUTATION_KEY = "send-message";
import {
  foldPartial,
  type LivePartial,
} from "@/shared/utils/live-partial";

const activeSubscriptions = new Map<string, Promise<void>>();

export type { LivePartial } from "@/shared/utils/live-partial";

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
  queryClient.setQueryData<LivePartial | null>(
    queryKeys.conversations.livePartial(conversationId),
    null,
  );
};

const handleStreamEvent = (
  conversationId: string,
  event: StreamEvent,
  queryClient: QueryClient,
): void => {
  // The backend's complete picture of what it has handed the CLI but the
  // CLI has not acked. Replaces whatever we held — it is sent on subscribe
  // and on every change, and the backend records a send before it answers
  // the POST, so there is nothing of ours it can be missing.
  if (event.type === "queue") {
    queryClient.setQueryData<string[]>(
      queryKeys.conversations.queuedMessageIds(conversationId),
      event.userMessageIds,
    );
    return;
  }

  // The CLI's own session state, verbatim. Note idle does NOT imply the
  // queue is empty: the CLI reports idle for a message it has not parsed
  // yet. The `queue` event above is the only thing that speaks for the
  // queue.
  if (event.type === "state") {
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) =>
        old
          ? { ...old, streamStatus: event.state === "idle" ? "idle" : "streaming" }
          : old,
    );
    if (event.state === "idle") {
      clearLive(conversationId, queryClient);
      // The CLI reports idle between chained turns — a queued follow-up it
      // has not parsed yet emits `running` moments later. A refetch fired in
      // that window reads a snapshot `running` contradicts, and its late
      // resolve would revert the cache for the whole next turn: no shimmer,
      // no Stop button, dropped rows. The queue event above is the authority
      // on whether more is coming, so reconcile only at the idle that ends
      // the chain. (A new send racing this refetch is already covered: the
      // mutation's onMutate cancels in-flight detail fetches.)
      const queued = queryClient.getQueryData<string[]>(
        queryKeys.conversations.queuedMessageIds(conversationId),
      );
      if (!queued?.length) {
        // This refetch is the transcript's reconciler: deletions never ride
        // the stream, and events can slip between the conversation GET and
        // the subscription attach. Once both ride the stream — deletion
        // events in the vocabulary, a seq cursor covering the attach gap —
        // it can go.
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.detail(conversationId),
        });
      }
    }
    return;
  }

  if (event.type === "partial") {
    queryClient.setQueryData<LivePartial | null>(
      queryKeys.conversations.livePartial(conversationId),
      (prev) => foldPartial(prev ?? null, event.partial.event),
    );
    return;
  }

  // The backend's fold of the block already in flight, sent once on subscribe.
  // Assigned wholesale: it is the same fold this handler would have produced
  // had we been connected for every delta.
  if (event.type === "livePartial") {
    queryClient.setQueryData<LivePartial | null>(
      queryKeys.conversations.livePartial(conversationId),
      event.livePartial,
    );
    return;
  }

  if (event.type === "message") {
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => {
        if (!old) return old;
        const index = old.messages.findIndex((m) => m.id === event.message.id);
        if (index === -1) {
          return { ...old, messages: [...old.messages, event.message] };
        }
        // The optimistic bubble for this send is already in the list, carrying
        // PENDING_SEQ and a client clock. Swap the persisted row in rather than
        // skipping it: same id, same content, but with the seq the DB actually
        // assigned — otherwise the placeholder lingers until the next refetch.
        const messages = [...old.messages];
        messages[index] = event.message;
        return { ...old, messages };
      },
    );

    // Any persisted assistant message means the in-flight block just finalized.
    // Blocks stream serially, so we don't need to match — there's only one to clear.
    if (event.message.sdkMessage.type === "assistant") {
      clearLive(conversationId, queryClient);
    }
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

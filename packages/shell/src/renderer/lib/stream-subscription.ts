import type { QueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";
import {
  subscribeToConversation,
  StreamDisconnectedError,
  type StreamEvent,
} from "./api";
import { queryKeys } from "./query-keys";

export const SEND_MESSAGE_MUTATION_KEY = "send-message";
import {
  foldPartial,
  type LivePartial,
} from "@/shared/utils/live-partial";

const activeSubscriptions = new Map<string, Promise<void>>();

export type { LivePartial } from "@/shared/utils/live-partial";

// seq is assigned by SQLite on insert, so a bubble that has not been persisted
// yet has no real one. This stands in until the persisted row arrives over the
// SSE and replaces it (see the "message" handler below). It sorts last, which
// is true — an optimistic message is always the newest thing in the transcript.
// It lives here, next to the one thing that derives a cursor from seq, because
// forgetting to skip it there means asking the backend to replay everything
// after MAX_SAFE_INTEGER: nothing, silently, forever.
export const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

// Reconnect is bounded on purpose. A subscription is never torn down when the
// user navigates away (one listener per conversation visited — the known leak),
// so an unbounded retry would let abandoned subscriptions resurrect themselves
// indefinitely. Once the subscription lifecycle is owned properly, this can go.
const BACKOFF_MS = [250, 500, 1000, 2000, 4000];

// Where we are in the transcript: the highest seq the cache actually holds.
// Optimistic rows are skipped — they carry PENDING_SEQ, not a real position.
// 0 means "send me everything", which is the right answer for an empty cache.
const cursorFor = (
  conversationId: string,
  queryClient: QueryClient,
): number => {
  const data = queryClient.getQueryData<ConversationWithMessages>(
    queryKeys.conversations.detail(conversationId),
  );
  if (!data) return 0;
  return data.messages.reduce(
    (max, m) => (m.seq !== PENDING_SEQ && m.seq > max ? m.seq : max),
    0,
  );
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const subscribeToStream = (
  conversationId: string,
  queryClient: QueryClient,
): void => {
  // Already subscribed - no-op
  if (activeSubscriptions.has(conversationId)) return;

  const promise = (async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          // The cursor is read fresh on every attempt, so a reconnect asks for
          // exactly what the drop cost us and nothing we already rendered.
          const stream = subscribeToConversation(
            conversationId,
            cursorFor(conversationId, queryClient),
          );

          for await (const event of stream) {
            // Any delivered event proves the link works; a connection that
            // flaps but keeps producing should not exhaust the budget meant
            // for one that can never open. -1 so the loop's ++ lands on 0.
            attempt = -1;
            handleStreamEvent(conversationId, event, queryClient);
          }
          // Ended cleanly: the backend sent a terminal event. Nothing to resume.
          return;
        } catch (e) {
          const retriable =
            e instanceof StreamDisconnectedError && e.retriable;
          if (!retriable || attempt >= BACKOFF_MS.length) {
            console.error("Stream subscription error:", e);
            handleStreamEvent(
              conversationId,
              {
                type: "error",
                error:
                  e instanceof Error ? e.message : "Stream connection failed",
              },
              queryClient,
            );
            return;
          }
          await delay(BACKOFF_MS[attempt]);
        }
      }
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
      // TODO: Rearchitect to a single stream endpoint that sends initial state + live events,
      // eliminating the race condition between initial fetch and stream subscription.
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.detail(conversationId),
      });
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
        // assigned — otherwise the placeholder lingers until the next refetch,
        // and the cursor never advances past it.
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

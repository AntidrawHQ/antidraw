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

type Subscription = { readonly promise: Promise<void>; readonly stop: () => void };

// One entry per conversation, and exactly one owner: the open conversation.
// Anything else that calls subscribeToStream is asserting "make sure this is
// running", not taking ownership — releasing is the owner's job alone.
const activeSubscriptions = new Map<string, Subscription>();

export type { LivePartial } from "@/shared/utils/live-partial";

// seq is assigned by SQLite on insert, so a bubble that has not been persisted
// yet has no real one. This stands in until the persisted row arrives over the
// SSE and replaces it (see the "message" handler below). It sorts last, which
// is true — an optimistic message is always the newest thing in the transcript.
// It lives here, next to the one thing that derives a cursor from seq, because
// forgetting to skip it there means asking the backend to replay everything
// after MAX_SAFE_INTEGER: nothing, silently, forever.
export const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

// Retries are bounded because streamStatus stays "streaming" throughout them:
// the spinner holds, which is right for a blip and wrong forever. Giving up is
// what turns a hung spinner into a reported error. An abandoned subscription
// resurrecting itself used to be the binding reason for the ceiling and is not
// any more — releaseStream ends the loop — so the budget is now set by how long
// a user should be left watching a spinner, which is about half a minute.
const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000, 8000];

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

// Resolves on the timer or on release, whichever comes first. Backoff is the
// one place the loop sits idle for seconds at a time; without this a released
// subscription would keep the conversation marked subscribed until it expired.
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

export const subscribeToStream = (
  conversationId: string,
  queryClient: QueryClient,
): void => {
  // Already subscribed - no-op
  if (activeSubscriptions.has(conversationId)) return;

  const release = new AbortController();
  // Whether this loop is still the one the map points at. Guards both exits
  // from deleting a slot a later subscription has already claimed.
  let ownsSlot = true;

  const vacate = () => {
    if (!ownsSlot) return;
    ownsSlot = false;
    activeSubscriptions.delete(conversationId);
  };

  const stop = () => {
    // Vacated first and synchronously, so a subscribe that follows this
    // release — React running a cleanup and then the effect again — starts a
    // new subscription instead of finding a dying one and no-oping onto it.
    vacate();
    // The signal reaches the live stream, which closes its iteration and
    // aborts the fetch, which fires the backend's request abort and detaches
    // its listeners. That last hop is the whole point of releasing at all.
    release.abort();
  };

  const promise = (async () => {
    try {
      for (let attempt = 0; !release.signal.aborted; attempt++) {
        try {
          // The cursor is read fresh on every attempt, so a reconnect asks for
          // exactly what the drop cost us and nothing we already rendered.
          const stream = subscribeToConversation(
            conversationId,
            cursorFor(conversationId, queryClient),
            release.signal,
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
          // A released subscription is not a failed one. Reporting an error
          // here would mark a conversation the user simply navigated away
          // from, and would write it into a cache nothing is watching.
          if (release.signal.aborted) return;

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
          await delay(BACKOFF_MS[attempt], release.signal);
        }
      }
    } finally {
      vacate();
    }
  })();

  activeSubscriptions.set(conversationId, { promise, stop });
};

// Ends the subscription and, through the abort, detaches the backend's
// listeners with it. Keyed on the conversation because there is only ever one
// owner of one subscription.
//
// Deliberately NOT called when a turn ends. The CLI reports idle between turns
// while the session stays alive, and it can report idle with a message we
// handed it still un-acked — releasing there would miss that ack and every
// event after it. The subscription belongs to the open conversation, not to
// the turn that happens to be running in it.
export const releaseStream = (conversationId: string): void => {
  activeSubscriptions.get(conversationId)?.stop();
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
        // Placed by seq, not appended: the stream promises nothing about the
        // order between a replayed backlog and live events, so a live message
        // can arrive ahead of older rows. Optimistic rows carry PENDING_SEQ
        // and so stay at the tail.
        //
        // A row already present is replaced rather than skipped. That is the
        // optimistic bubble for this send, holding PENDING_SEQ and a client
        // clock; the persisted row has the same id and content but the seq
        // the DB actually assigned — leave the placeholder and the cursor
        // never advances past it.
        const messages = old.messages.filter((m) => m.id !== event.message.id);
        const at = messages.findIndex((m) => m.seq > event.message.seq);
        messages.splice(at === -1 ? messages.length : at, 0, event.message);
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

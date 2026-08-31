import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { UUID } from "node:crypto";
import type {
  ConversationWithMessages,
  Message,
  StreamEvent,
} from "@/main/api";
import { createUserSDKMessage } from "@/shared/utils/message";
import { queryKeys } from "../query-keys";

// Only the transport is faked. StreamDisconnectedError stays the real class —
// the reconnect decision turns on `instanceof`, so a local stand-in would let
// the two drift apart without a test noticing.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, subscribeToConversation: vi.fn() };
});

const { subscribeToConversation } = await import("../api");
const { StreamDisconnectedError } = await import("../api");
const { subscribeToStream, releaseStream, isSubscribed, PENDING_SEQ } =
  await import("../stream-subscription");

const mockSubscribe = vi.mocked(subscribeToConversation);

// One attempt's worth of stream: some events, then either a clean end or a
// throw. A clean end is what the backend sending a terminal event looks like.
type Attempt = {
  events?: StreamEvent[];
  throws?: unknown;
  // Stands in for a live stream with nothing to say — the state a
  // subscription spends almost all of its time in. It ends only when the
  // release signal reaches it, which is exactly what the real transport does.
  hangs?: boolean;
  // The transport failing at the same moment it is released: both endings are
  // reachable from one teardown, and which wins is a race.
  throwsOnRelease?: unknown;
};

// Streams still running. Release clears the map entry synchronously, so the
// map says nothing about whether the loop actually unwound — this does.
const open = { count: 0 };

const scriptAttempts = (attempts: Attempt[]) => {
  const cursors: (number | undefined)[] = [];
  const remaining = [...attempts];
  mockSubscribe.mockImplementation(((
    _conversationId: string,
    afterSeq?: number,
    releaseSignal?: AbortSignal,
  ) => {
    cursors.push(afterSeq);
    const attempt = remaining.shift() ?? {};
    const released = () =>
      new Promise<void>((resolve) => {
        if (releaseSignal?.aborted) return resolve();
        releaseSignal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    open.count++;
    return (async function* () {
      try {
        for (const event of attempt.events ?? []) yield event;
        if (attempt.hangs) {
          await released();
          return;
        }
        if (attempt.throwsOnRelease !== undefined) {
          await released();
          throw attempt.throwsOnRelease;
        }
        if (attempt.throws !== undefined) throw attempt.throws;
      } finally {
        open.count--;
      }
    })();
  }) as typeof subscribeToConversation);
  return cursors;
};

let counter = 0;
const freshId = () => `conversation-${counter++}`;

const message = (seq: number, text: string): Message => {
  const id = crypto.randomUUID();
  return {
    id,
    conversationId: "unused",
    messageType: "user_prompt",
    sdkMessage: createUserSDKMessage({ text, uuid: id as UUID }),
    seq,
    createdAt: new Date(0),
  };
};

const seedCache = (
  queryClient: QueryClient,
  conversationId: string,
  messages: Message[],
) => {
  queryClient.setQueryData<ConversationWithMessages>(
    queryKeys.conversations.detail(conversationId),
    {
      id: conversationId,
      workspaceId: "w",
      claudeCodeSessionId: null,
      title: null,
      summary: null,
      selectedModel: null,
      selectedEffort: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      streamStatus: "streaming",
      messages,
    },
  );
};

const detail = (queryClient: QueryClient, conversationId: string) =>
  queryClient.getQueryData<ConversationWithMessages>(
    queryKeys.conversations.detail(conversationId),
  )!;

// Drives fake timers and the microtask queue until the subscription's loop has
// run itself out. Backoff is real time in production; here it is skipped.
// Drains unconditionally rather than while isSubscribed: release clears the
// map entry up front, so looping on it would exit before anything the loop
// still had to do — including writing an error — had a chance to happen.
const settle = async (conversationId: string) => {
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
  }
  expect(isSubscribed(conversationId)).toBe(false);
};

// Lets the loop advance without driving it to completion — used where the
// subscription is meant to still be alive afterwards.
const flush = async (ticks = 20) => {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
};

let queryClient: QueryClient;

beforeEach(() => {
  open.count = 0;
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockSubscribe.mockReset();
});

describe("the resume cursor", () => {
  test("is the highest seq the cache holds", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, [
      message(4, "a"),
      message(9, "b"),
      message(7, "c"),
    ]);
    const cursors = scriptAttempts([{}]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(cursors).toEqual([9]);
  });

  test("skips optimistic rows rather than reading MAX_SAFE_INTEGER", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, [
      message(4, "a"),
      message(PENDING_SEQ, "not persisted yet"),
    ]);
    const cursors = scriptAttempts([{}]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // A cursor of PENDING_SEQ asks for everything after the largest number
    // there is: nothing, forever, with no error to notice it by.
    expect(cursors).toEqual([4]);
  });

  test("is 0 when the cache is empty", async () => {
    const conversationId = freshId();
    const cursors = scriptAttempts([{}]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(cursors).toEqual([0]);
  });
});

describe("reconnecting", () => {
  test("resumes from what the dropped attempt actually delivered", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, [message(1, "a")]);
    const cursors = scriptAttempts([
      {
        events: [{ type: "message", message: message(2, "b") }],
        throws: new StreamDisconnectedError("socket closed", true),
      },
      { events: [{ type: "message", message: message(3, "c") }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // The second attempt asks for 2, not 1: the message the first attempt
    // delivered before dying is not asked for again.
    expect(cursors).toEqual([1, 2]);
    expect(detail(queryClient, conversationId).messages.map((m) => m.seq)).toEqual(
      [1, 2, 3],
    );
  });

  test("leaves the status alone while it retries", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    scriptAttempts([
      { throws: new StreamDisconnectedError("socket closed", true) },
      { events: [{ type: "state", state: "running" }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // A blip is not a failed conversation: the spinner holds through the gap
    // and the resumed stream's state seed settles it.
    expect(detail(queryClient, conversationId).streamStatus).toBe("streaming");
  });

  test("gives up after the budget and surfaces the failure", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts(
      Array.from({ length: 20 }, () => ({
        throws: new StreamDisconnectedError("refused", true),
      })),
    );

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(cursors).toHaveLength(8); // the first try plus one per backoff step
    expect(detail(queryClient, conversationId).streamStatus).toBe("error");
  });

  test("delivered progress buys back the retry budget", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const drop = { throws: new StreamDisconnectedError("flap", true) };
    const flap = {
      // A row, not a seed: progress is the cursor advancing, and only
      // progress refunds the budget (see the test below for why).
      events: [{ type: "message" as const, message: message(1, "b") }],
      throws: new StreamDisconnectedError("flap", true),
    };
    const cursors = scriptAttempts([
      ...Array.from({ length: 5 }, () => drop),
      flap, // partway through the budget, but it makes progress
      ...Array.from({ length: 12 }, () => drop),
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // 6 attempts up to and including the flap, then a full budget of 8 after
    // it. Without the reset the run would have stopped at 8 in total.
    expect(cursors).toHaveLength(14);
  });

  test("seeds alone do not buy back the budget", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    // The backend sends its state/queue/livePartial seeds unconditionally on
    // every successful attach. A link that accepts the stream and then drops
    // the body — a main-process reload loop, a torn-down CLI handle — thus
    // delivers events on every cycle without ever making progress.
    const cursors = scriptAttempts(
      Array.from({ length: 20 }, () => ({
        events: [{ type: "state" as const, state: "running" as const }],
        throws: new StreamDisconnectedError("dropped after attach", true),
      })),
    );

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // The same budget as a link that never opens: the seeds cost the backend
    // nothing and prove nothing about progress, so they must not refund the
    // ceiling — otherwise this link reconnects forever behind a spinner.
    expect(cursors.length).toBeLessThanOrEqual(8);
    expect(detail(queryClient, conversationId).streamStatus).toBe("error");
  });

  test("the retry after a delivered event still backs off", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([
      {
        events: [{ type: "state" as const, state: "running" as const }],
        throws: new StreamDisconnectedError("dropped after attach", true),
      },
      {}, // the reconnect, ending cleanly
    ]);

    subscribeToStream(conversationId, queryClient);
    await flush();
    expect(cursors).toHaveLength(1); // dropped, now meant to be in backoff

    // The refund sets attempt to -1, and BACKOFF_MS[-1] is undefined:
    // setTimeout(done, undefined) fires immediately. A real first-step
    // backoff holds through anything short of it.
    await vi.advanceTimersByTimeAsync(249);
    await flush();
    expect(cursors).toHaveLength(1);

    await settle(conversationId);
    expect(cursors).toHaveLength(2);
  });

  test("does not retry a conversation the backend says is gone", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([
      { throws: new StreamDisconnectedError("Conversation not found", false) },
      { events: [{ type: "state", state: "running" }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(cursors).toHaveLength(1);
    expect(detail(queryClient, conversationId).streamStatus).toBe("error");
  });

  test("does not retry a turn that failed", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([
      // A backend `error` event is the turn dying, not the link. The stream
      // ends cleanly after it, and resuming would only replay the same death.
      { events: [{ type: "error", error: "spawn failed" }] },
      { events: [{ type: "state", state: "running" }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(cursors).toHaveLength(1);
    expect(detail(queryClient, conversationId).streamStatus).toBe("error");
  });

  test("an unexpected throw is not treated as a dropped link", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([
      { throws: new TypeError("bug in the reducer") },
      { events: [{ type: "state", state: "running" }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(cursors).toHaveLength(1);
  });
});

describe("replayed events", () => {
  test("a message delivered twice lands once", async () => {
    const conversationId = freshId();
    const existing = message(1, "a");
    seedCache(queryClient, conversationId, [existing]);
    const replayed = message(2, "b");
    scriptAttempts([
      {
        events: [
          { type: "message", message: replayed },
          { type: "message", message: replayed },
        ],
      },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(detail(queryClient, conversationId).messages.map((m) => m.id)).toEqual(
      [existing.id, replayed.id],
    );
  });

  test("a message arriving ahead of older rows is placed by seq", async () => {
    const conversationId = freshId();
    const existing = message(1, "a");
    seedCache(queryClient, conversationId, [existing]);
    // The stream sends live events straight through while the backlog is
    // still being read, so the newer row can land first.
    const live = message(3, "live");
    const backlog = message(2, "backlog");
    scriptAttempts([
      {
        events: [
          { type: "message", message: live },
          { type: "message", message: backlog },
        ],
      },
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(
      detail(queryClient, conversationId).messages.map((m) => m.seq),
    ).toEqual([1, 2, 3]);
  });

  test("an optimistic bubble stays at the tail of rows placed by seq", async () => {
    const conversationId = freshId();
    const optimistic = message(PENDING_SEQ, "sent");
    seedCache(queryClient, conversationId, [optimistic]);
    const persisted = message(5, "earlier");
    scriptAttempts([{ events: [{ type: "message", message: persisted }] }]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    expect(
      detail(queryClient, conversationId).messages.map((m) => m.id),
    ).toEqual([persisted.id, optimistic.id]);
  });

  test("a replayed row replaces the optimistic bubble it matches", async () => {
    const conversationId = freshId();
    const optimistic = message(PENDING_SEQ, "sent");
    seedCache(queryClient, conversationId, [optimistic]);
    const persisted = { ...optimistic, seq: 12 };
    scriptAttempts([{ events: [{ type: "message", message: persisted }] }]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // Both halves matter: one row, and its seq is real — a lingering
    // PENDING_SEQ would poison the next cursor.
    expect(detail(queryClient, conversationId).messages).toEqual([persisted]);
  });
});

describe("releasing", () => {
  test("ends the loop and stops reconnecting", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([
      { throws: new StreamDisconnectedError("dropped", true) },
      { events: [{ type: "state", state: "running" }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await flush();
    releaseStream(conversationId);
    await settle(conversationId);

    // The drop was retriable, so without the release a second attempt would
    // have followed it.
    expect(cursors).toHaveLength(1);
  });

  test("does not wait out a backoff it is sitting in", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    scriptAttempts([{ throws: new StreamDisconnectedError("dropped", true) }]);

    subscribeToStream(conversationId, queryClient);
    await flush();

    // Mid-backoff. Releasing has to interrupt the timer, not merely be
    // noticed once it expires.
    releaseStream(conversationId);
    await flush();
    expect(isSubscribed(conversationId)).toBe(false);
  });

  test("is not reported as a failed conversation", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    scriptAttempts([{ throws: new StreamDisconnectedError("dropped", true) }]);

    subscribeToStream(conversationId, queryClient);
    await flush();
    releaseStream(conversationId);
    await settle(conversationId);

    // Navigating away is not an error, and the cache it would be written to
    // is one nothing is watching any more.
    expect(detail(queryClient, conversationId).streamStatus).toBe("streaming");
  });

  test("frees the slot immediately, so a resubscribe takes hold", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([
      { throws: new StreamDisconnectedError("dropped", true) },
      { events: [{ type: "state", state: "running" }] },
    ]);

    subscribeToStream(conversationId, queryClient);
    await flush();

    // React runs a cleanup and then the effect again. The releasing loop is
    // still unwinding at this point; if its exit cleared the map afterwards,
    // the new subscription would be silently dropped on the floor.
    releaseStream(conversationId);
    subscribeToStream(conversationId, queryClient);
    expect(isSubscribed(conversationId)).toBe(true);

    await settle(conversationId);
    expect(cursors).toHaveLength(2);
  });

  test("ends a stream that is sitting idle with nothing to say", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const cursors = scriptAttempts([{ hangs: true }]);

    subscribeToStream(conversationId, queryClient);
    await flush();
    // The loop is parked inside the stream, not between attempts. Only the
    // signal reaching the transport can end it — settle asserts it did.
    releaseStream(conversationId);
    await settle(conversationId);

    expect(cursors).toHaveLength(1);
    // The map entry goes synchronously either way; this is the assertion that
    // distinguishes a released stream from one still sitting open forever.
    expect(open.count).toBe(0);
    expect(detail(queryClient, conversationId).streamStatus).toBe("streaming");
  });

  test("a transport failure racing the release is still not an error", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    // Non-retriable, so without the released-check this takes the give-up
    // branch and paints the conversation red on the way out.
    scriptAttempts([
      { throwsOnRelease: new StreamDisconnectedError("gone", false) },
    ]);

    subscribeToStream(conversationId, queryClient);
    await flush();
    releaseStream(conversationId);
    await settle(conversationId);

    expect(detail(queryClient, conversationId).streamStatus).toBe("streaming");
    expect(open.count).toBe(0);
  });

  test("is a no-op for a conversation that was never subscribed", () => {
    expect(() => releaseStream(freshId())).not.toThrow();
  });
});

describe("the idle invalidate", () => {
  test("a turn ending reconciles the transcript", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []); // streaming
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    scriptAttempts([{ events: [{ type: "state", state: "idle" }] }]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // This is the only thing reconciling deletions, and a deletion can only
    // have happened during the turn that just ended.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.conversations.detail(conversationId),
    });
  });

  test("attaching to a conversation that was already idle does not refetch", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => (old ? { ...old, streamStatus: "idle" } : old),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    // Every attach seeds `state`, so an idle conversation seeds idle again.
    // Now that the subscription is held for any open conversation rather than
    // only a streaming one, this is the common case on opening one.
    scriptAttempts([{ events: [{ type: "state", state: "idle" }] }]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // The query that opened the conversation has just read these same rows.
    expect(invalidate).not.toHaveBeenCalled();
  });
});

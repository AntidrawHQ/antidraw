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
const { subscribeToStream, isSubscribed, PENDING_SEQ } = await import(
  "../stream-subscription"
);

const mockSubscribe = vi.mocked(subscribeToConversation);

// One attempt's worth of stream: some events, then either a clean end or a
// throw. A clean end is what the backend sending a terminal event looks like.
type Attempt = { events?: StreamEvent[]; throws?: unknown };

const scriptAttempts = (attempts: Attempt[]) => {
  const cursors: (number | undefined)[] = [];
  const remaining = [...attempts];
  mockSubscribe.mockImplementation(((
    _conversationId: string,
    afterSeq?: number,
  ) => {
    cursors.push(afterSeq);
    const attempt = remaining.shift() ?? {};
    return (async function* () {
      for (const event of attempt.events ?? []) yield event;
      if (attempt.throws !== undefined) throw attempt.throws;
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
const settle = async (conversationId: string) => {
  for (let i = 0; i < 100 && isSubscribed(conversationId); i++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
  }
  expect(isSubscribed(conversationId)).toBe(false);
};

let queryClient: QueryClient;

beforeEach(() => {
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

    expect(cursors).toHaveLength(6); // the first try plus five retries
    expect(detail(queryClient, conversationId).streamStatus).toBe("error");
  });

  test("a delivered event buys back the retry budget", async () => {
    const conversationId = freshId();
    seedCache(queryClient, conversationId, []);
    const drop = { throws: new StreamDisconnectedError("flap", true) };
    const flap = {
      events: [{ type: "state" as const, state: "running" as const }],
      throws: new StreamDisconnectedError("flap", true),
    };
    const cursors = scriptAttempts([
      drop,
      drop,
      drop,
      drop,
      drop,
      flap, // sixth attempt would be the last, but it delivers something
      ...Array.from({ length: 10 }, () => drop),
    ]);

    subscribeToStream(conversationId, queryClient);
    await settle(conversationId);

    // Budget resets at the flap, so five more attempts follow it.
    expect(cursors).toHaveLength(12);
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

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { UUID } from "node:crypto";
import { ok } from "neverthrow";
import type { ConversationWithMessages, Message, StreamEvent } from "@/main/api";
import { createUserSDKMessage } from "@/shared/utils/message";
import { queryKeys } from "../query-keys";

// Both halves of ../api: the stream the reducer consumes, and the fetch the
// invalidate triggers. Everything between them is the real thing.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    subscribeToConversation: vi.fn(),
    getConversationWithMessages: vi.fn(),
  };
});

const { subscribeToConversation, getConversationWithMessages } = await import(
  "../api"
);
const { subscribeToStream, releaseStream, PENDING_SEQ } = await import(
  "../stream-subscription"
);
const { conversationQueryOpts } = await import("../claude-code-ops");

const mockStream = vi.mocked(subscribeToConversation);
const mockFetch = vi.mocked(getConversationWithMessages);

let counter = 0;
const freshId = () => `conversation-${counter++}`;

const row = (seq: number, text: string): Message => {
  const id = crypto.randomUUID();
  return {
    id,
    conversationId: "c",
    messageType: "user_prompt",
    sdkMessage: createUserSDKMessage({ text, uuid: id as UUID }),
    seq,
    createdAt: new Date(0),
  };
};

const conversation = (
  id: string,
  messages: Message[],
  streamStatus: ConversationWithMessages["streamStatus"] = "streaming",
): ConversationWithMessages => ({
  id,
  workspaceId: "w",
  claudeCodeSessionId: null,
  title: null,
  summary: null,
  selectedModel: null,
  selectedEffort: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  streamStatus,
  messages,
});

let queryClient: QueryClient;
let stop: (() => void) | null = null;

// The app's shape: the detail query mounted with its real options, so the
// invalidate has an observer to serve and actually refetches. gcTime is pinned
// rather than inherited — it is Infinity today only because environment "node"
// makes isServer() true, and that stops holding the moment jsdom is added.
const mount = (conversationId: string) => {
  const observer = new QueryObserver(
    queryClient,
    conversationQueryOpts(conversationId),
  );
  stop = observer.subscribe(() => {});
  return observer;
};

const script = (events: StreamEvent[]) => {
  mockStream.mockImplementation((() =>
    (async function* () {
      for (const e of events) yield e;
    })()) as typeof subscribeToConversation);
};

const detail = (conversationId: string) =>
  queryClient.getQueryData<ConversationWithMessages>(
    queryKeys.conversations.detail(conversationId),
  )!;

const idle = async (ms = 30) => {
  await new Promise((r) => setTimeout(r, ms));
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.restoreAllMocks();
  mockStream.mockReset();
  mockFetch.mockReset();
});

describe("the idle invalidate, with something watching", () => {
  test("a turn ending reconciles the transcript against the server", async () => {
    const conversationId = freshId();
    const server = [row(1, "a"), row(2, "b")];
    mockFetch.mockResolvedValue(ok(conversation(conversationId, server, "idle")));

    mount(conversationId);
    await idle();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // A row the stream delivered that the server also has, then the turn ends.
    script([
      { type: "state", state: "running" },
      { type: "message", message: server[1]! },
      { type: "state", state: "idle" },
    ]);
    subscribeToStream(conversationId, queryClient);
    await idle();

    // This is the half no previous test could reach: the refetch ran, and its
    // answer is what the cache now holds. Deletions the stream never carries
    // are reconciled here and nowhere else.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(detail(conversationId).messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  test("a plain reattach at idle does not refetch", async () => {
    const conversationId = freshId();
    mockFetch.mockResolvedValue(
      ok(conversation(conversationId, [row(1, "a")], "idle")),
    );

    mount(conversationId);
    await idle();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Every attach seeds `state`. Opening an already-idle conversation must not
    // re-read rows the mount just read — that is what `wasStreaming` is for.
    script([{ type: "state", state: "idle" }]);
    subscribeToStream(conversationId, queryClient);
    await idle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("a row the stream delivered is not duplicated by the refetch", async () => {
    const conversationId = freshId();
    const persisted = row(1, "a");
    const late = row(2, "arrived late");
    // runTurn writes the row before anything emits it (turn.ts:201, ahead of
    // the dispatch at :223), so a refetch resolving after the event has it
    // too. Both halves carry the same row; the reconcile must land on one.
    mockFetch.mockResolvedValue(
      ok(conversation(conversationId, [persisted, late], "idle")),
    );

    mount(conversationId);
    await idle();

    script([
      { type: "state", state: "running" },
      { type: "message", message: late },
      { type: "state", state: "idle" },
    ]);
    subscribeToStream(conversationId, queryClient);
    await idle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(detail(conversationId).messages.map((m) => m.id)).toEqual([
      persisted.id,
      late.id,
    ]);
  });

  test("the refetch swaps a real seq in for the optimistic bubble", async () => {
    const conversationId = freshId();
    const bubble = row(PENDING_SEQ, "just sent");
    // Same ordering: the prompt is a persisted row before the POST answers, so
    // the server's copy carries the seq the DB assigned. The bubble is the
    // same message, not a second one.
    mockFetch.mockResolvedValue(
      ok(
        conversation(
          conversationId,
          [row(1, "a"), { ...bubble, seq: 5 }],
          "idle",
        ),
      ),
    );

    mount(conversationId);
    await idle();
    queryClient.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(conversationId),
      (old) => ({ ...old!, messages: [...old!.messages, bubble] }),
    );

    script([
      { type: "state", state: "running" },
      { type: "state", state: "idle" },
    ]);
    subscribeToStream(conversationId, queryClient);
    await idle();

    const rows = detail(conversationId).messages.filter(
      (m) => m.id === bubble.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seq).toBe(5);
  });
});

describe("the error invalidate", () => {
  test("the refetch agrees with the error rather than overwriting it", async () => {
    const conversationId = freshId();
    // A backend `error` event means runColdStart already called markError
    // (turn.ts:174) before emitting, so getStreamStatus answers "error" too.
    // That agreement is the whole reason this branch may invalidate at all —
    // bfa82eb moved the give-up onto a path that does not, precisely because
    // nothing on the backend knows about a client-side give-up.
    mockFetch.mockResolvedValue(
      ok(conversation(conversationId, [row(1, "a")], "error")),
    );

    mount(conversationId);
    await idle();

    script([{ type: "error", error: "spawn failed" }]);
    subscribeToStream(conversationId, queryClient);
    await idle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(detail(conversationId).streamStatus).toBe("error");
  });
});

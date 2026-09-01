import { describe, test, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";

// Only the transport is faked — the handler, the query cache and the
// invalidate/refetch machinery are all real.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, subscribeToConversation: vi.fn() };
});

const { subscribeToConversation } = await import("../api");
const { subscribeToStream } = await import("../stream-subscription");
const { queryKeys } = await import("../query-keys");
import type { StreamEvent } from "../api";

const mockSubscribe = vi.mocked(subscribeToConversation);

// A hand-pumped stream: the test pushes events and the subscription's
// for-await consumes them, exactly as SSE frames would arrive.
const channel = () => {
  const buffer: StreamEvent[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  return {
    push(event: StreamEvent) {
      buffer.push(event);
      notify?.();
      notify = undefined;
    },
    close() {
      closed = true;
      notify?.();
      notify = undefined;
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (buffer.length) yield buffer.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => (notify = resolve));
      }
    },
  };
};

// Let the for-await loop and any query fetches settle.
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const snapshot = (
  id: string,
  streamStatus: ConversationWithMessages["streamStatus"],
): ConversationWithMessages =>
  ({ id, streamStatus, messages: [] }) as unknown as ConversationWithMessages;

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.clearAllMocks();
});

describe("the idle between chained turns", () => {
  test("does not refetch while a follow-up is queued; reconciles at the chain's end", async () => {
    const id = crypto.randomUUID();
    const detailKey = queryKeys.conversations.detail(id);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    // The conversation is loaded and a turn is streaming.
    queryClient.setQueryData(detailKey, snapshot(id, "streaming"));

    // An active observer, so invalidateQueries actually refetches — this is
    // the GET the race rides on.
    const queryFn = vi.fn(async () => snapshot(id, "idle"));
    const observer = new QueryObserver(queryClient, {
      queryKey: detailKey,
      queryFn,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    cleanup.push(unsubscribe, () => queryClient.clear());

    const stream = channel();
    cleanup.push(() => stream.close());
    mockSubscribe.mockReturnValue(stream[Symbol.asyncIterator]());
    subscribeToStream(id, queryClient);

    // A follow-up is queued behind the running turn...
    stream.push({ type: "queue", userMessageIds: ["follow-up-1"] } as StreamEvent);
    // ...and the CLI flickers idle before parsing it.
    stream.push({ type: "state", state: "idle" } as StreamEvent);
    await settle();

    // No refetch in the flicker window: a GET started here would carry
    // streamStatus "idle" and a pre-follow-up transcript, and its late
    // resolve would revert the cache for the whole next turn.
    expect(queryFn).not.toHaveBeenCalled();

    stream.push({ type: "state", state: "running" } as StreamEvent);
    await settle();
    expect(
      queryClient.getQueryData<ConversationWithMessages>(detailKey)
        ?.streamStatus,
    ).toBe("streaming");

    // The follow-up is acked and its turn ends: NOW the queue is empty and
    // the end-of-chain idle reconciles.
    stream.push({ type: "queue", userMessageIds: [] } as StreamEvent);
    stream.push({ type: "state", state: "idle" } as StreamEvent);
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<ConversationWithMessages>(detailKey)
        ?.streamStatus,
    ).toBe("idle");
  });

  test("a plain end of turn — nothing queued — still reconciles", async () => {
    const id = crypto.randomUUID();
    const detailKey = queryKeys.conversations.detail(id);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(detailKey, snapshot(id, "streaming"));

    const queryFn = vi.fn(async () => snapshot(id, "idle"));
    const observer = new QueryObserver(queryClient, {
      queryKey: detailKey,
      queryFn,
      staleTime: Infinity,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    cleanup.push(unsubscribe, () => queryClient.clear());

    const stream = channel();
    cleanup.push(() => stream.close());
    mockSubscribe.mockReturnValue(stream[Symbol.asyncIterator]());
    subscribeToStream(id, queryClient);

    stream.push({ type: "state", state: "idle" } as StreamEvent);
    await settle();

    // The guard must not swallow the normal reconcile.
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Only the transport is faked. The registry, the retry loop and the effect
// body under test are all the real ones.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, subscribeToConversation: vi.fn() };
});

const { subscribeToConversation } = await import("../api");
const { openConversationSubscription } = await import("../claude-code-ops");
const { isSubscribed } = await import("../stream-subscription");
const mockSubscribe = vi.mocked(subscribeToConversation);

// Streams still running. The map entry goes synchronously on release, so it
// says nothing about whether the transport was actually let go — this does.
const open = { count: 0 };

const freshId = () => crypto.randomUUID();
const flush = async (ticks = 20) => {
  for (let ticks_ = 0; ticks_ < ticks; ticks_++) await Promise.resolve();
};

let queryClient: QueryClient;

beforeEach(() => {
  open.count = 0;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A stream with nothing to say, which is what a subscription mostly is. It
  // ends only when the release signal reaches it.
  mockSubscribe.mockImplementation(((
    _conversationId: string,
    _afterSeq?: number,
    release?: AbortSignal,
  ) => {
    open.count++;
    return (async function* () {
      try {
        await new Promise<void>((resolve) => {
          if (release?.aborted) return resolve();
          release?.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        open.count--;
      }
    })();
  }) as typeof subscribeToConversation);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockSubscribe.mockReset();
});

// What React does with this effect, without React: the hook passes
// activeConversationId and the query client, and re-runs the pair on a change.
describe("the conversation subscription effect", () => {
  test("subscribes for the conversation that is open", async () => {
    const id = freshId();

    const cleanup = openConversationSubscription(id, queryClient);
    expect(isSubscribed(id)).toBe(true);

    cleanup?.();
    await flush();
  });

  test("its cleanup releases, and the release reaches the transport", async () => {
    const id = freshId();
    const cleanup = openConversationSubscription(id, queryClient);
    await flush();
    expect(open.count).toBe(1);

    cleanup!();

    expect(isSubscribed(id)).toBe(false);
    await flush();
    // The map entry clears either way; this is what distinguishes a released
    // stream from one left sitting open forever.
    expect(open.count).toBe(0);
  });

  test("acquires nothing when no conversation is open", () => {
    expect(openConversationSubscription(null, queryClient)).toBeUndefined();
    expect(open.count).toBe(0);
  });

  test("switching conversations moves the subscription across", async () => {
    const a = freshId();
    const b = freshId();

    const cleanupA = openConversationSubscription(a, queryClient);
    await flush();
    expect(isSubscribed(a)).toBe(true);

    // React on a changed id: cleanup for the old value, then the effect again
    // with the new one.
    cleanupA!();
    const cleanupB = openConversationSubscription(b, queryClient);

    expect(isSubscribed(a)).toBe(false);
    expect(isSubscribed(b)).toBe(true);
    await flush();
    // One stream, not two: the conversation left behind is not still watched.
    expect(open.count).toBe(1);

    cleanupB!();
    await flush();
    expect(open.count).toBe(0);
  });

  test("is held for a conversation that is not streaming", async () => {
    const id = freshId();
    // Nothing seeded, no turn in flight. Acquisition does not ask: gating it
    // on streamStatus is what left a conversation whose status went stale
    // unwatched with no way back.
    const cleanup = openConversationSubscription(id, queryClient);
    await flush();

    expect(isSubscribed(id)).toBe(true);
    expect(open.count).toBe(1);

    cleanup!();
    await flush();
  });
});

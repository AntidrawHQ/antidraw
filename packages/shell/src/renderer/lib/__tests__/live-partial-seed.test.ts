import { describe, test, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { LivePartial } from "@/shared/utils/live-partial";

// Only the transport is faked — the handler and the query cache are real.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, subscribeToConversation: vi.fn() };
});

const { subscribeToConversation } = await import("../api");
const { subscribeToStream } = await import("../stream-subscription");
const { queryKeys } = await import("../query-keys");
import type { StreamEvent } from "../api";

const mockSubscribe = vi.mocked(subscribeToConversation);

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => vi.clearAllMocks());

describe("the livePartial seed", () => {
  test("a raw tool_use seed renders its input on attach, not on the next delta", async () => {
    const id = crypto.randomUUID();
    const queryClient = new QueryClient();

    // What main sends since it stopped parsing: input as the block started,
    // the accumulated json riding alongside. A block that finished streaming
    // before the attach gets no further delta — this parse is its only one.
    const rawSeed: LivePartial = {
      index: 0,
      block: { type: "tool_use", id: "t1", name: "Write", input: {} } as never,
      partialJson: '{"file_path":"/App.tsx","content":"expor',
    };

    mockSubscribe.mockReturnValue(
      (async function* () {
        yield { type: "livePartial", livePartial: rawSeed } as StreamEvent;
      })(),
    );
    subscribeToStream(id, queryClient);
    await settle();

    const installed = queryClient.getQueryData<LivePartial>(
      queryKeys.conversations.livePartial(id),
    );
    expect(installed?.block).toMatchObject({
      type: "tool_use",
      input: { file_path: "/App.tsx", content: "expor" },
    });
    // The raw accumulator survives, so later deltas keep folding onto it.
    expect(installed?.partialJson).toBe(rawSeed.partialJson);
  });

  test("a null seed — no block in flight — passes through", async () => {
    const id = crypto.randomUUID();
    const queryClient = new QueryClient();
    queryClient.setQueryData<LivePartial | null>(
      queryKeys.conversations.livePartial(id),
      { index: 0, block: { type: "text", text: "stale" } as never },
    );

    mockSubscribe.mockReturnValue(
      (async function* () {
        yield { type: "livePartial", livePartial: null } as StreamEvent;
      })(),
    );
    subscribeToStream(id, queryClient);
    await settle();

    expect(
      queryClient.getQueryData<LivePartial | null>(
        queryKeys.conversations.livePartial(id),
      ),
    ).toBeNull();
  });
});

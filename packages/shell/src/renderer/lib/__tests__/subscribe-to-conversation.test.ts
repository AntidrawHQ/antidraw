import { describe, test, expect, vi, beforeEach } from "vitest";
import type { StreamEvent } from "@/main/api";

// The transport is the one place the release signal has to reach real
// machinery: closing the iteration for the consumer AND aborting the fetch,
// which is what makes the backend drop its listeners. Mocked at the library
// boundary so the handlers can be driven directly.
const h = vi.hoisted(() => ({
  calls: [] as {
    url: string;
    signal: AbortSignal;
    onmessage: (ev: { data: string }) => void;
    onclose: () => void;
    onerror: (e: unknown) => void;
    onopen: (r: Response) => Promise<void>;
  }[],
}));

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: (url: string, opts: Record<string, unknown>) => {
    h.calls.push({ url, ...opts } as (typeof h.calls)[number]);
    return new Promise(() => {});
  },
}));

const { subscribeToConversation, StreamDisconnectedError } = await import(
  "../api"
);

beforeEach(() => {
  h.calls.length = 0;
});

const drain = async (
  gen: AsyncGenerator<StreamEvent>,
  got: StreamEvent[],
): Promise<unknown> => {
  try {
    for await (const e of gen) got.push(e);
    return null;
  } catch (e) {
    return e;
  }
};

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("subscribeToConversation", () => {
  test("puts afterSeq on the query string, and omits it when unset", async () => {
    void drain(subscribeToConversation("abc", 12), []);
    void drain(subscribeToConversation("abc"), []);
    await flush();

    expect(h.calls[0].url).toBe("antidraw://app/api/chat/abc/stream?afterSeq=12");
    expect(h.calls[1].url).toBe("antidraw://app/api/chat/abc/stream");
  });

  test("a release ends the iteration cleanly and aborts the fetch", async () => {
    const release = new AbortController();
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0, release.signal), got);
    await flush();

    h.calls[0].onmessage({
      data: JSON.stringify({ type: "state", state: "running" }),
    });
    await flush();
    expect(h.calls[0].signal.aborted).toBe(false);

    release.abort();
    await flush();

    // Cleanly: the caller asked for this, so there is nothing to report.
    expect(await done).toBeNull();
    expect(got).toEqual([{ type: "state", state: "running" }]);
    // And the fetch is aborted, which is what fires the backend's request
    // abort and detaches its listeners.
    expect(h.calls[0].signal.aborted).toBe(true);
  });

  test("a release that arrives before the stream opens still ends it", async () => {
    const release = new AbortController();
    release.abort();
    const got: StreamEvent[] = [];

    expect(await drain(subscribeToConversation("abc", 0, release.signal), got))
      .toBeNull();
    expect(got).toEqual([]);
  });

  test("a transport error is a retriable disconnect, not an event", async () => {
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0), got);
    await flush();

    h.calls[0].onmessage({
      data: JSON.stringify({ type: "state", state: "running" }),
    });
    expect(() => h.calls[0].onerror(new Error("socket closed"))).toThrow();
    await flush();

    const e = await done;
    expect(e).toBeInstanceOf(StreamDisconnectedError);
    expect((e as InstanceType<typeof StreamDisconnectedError>).retriable).toBe(
      true,
    );
    // Enqueued events drain before the throw — nothing already received is lost.
    expect(got).toEqual([{ type: "state", state: "running" }]);
  });

  test("a 404 on open is not retriable; a 500 is", async () => {
    for (const [status, retriable] of [
      [404, false],
      [500, true],
    ] as const) {
      h.calls.length = 0;
      const done = drain(subscribeToConversation("abc", 0), []);
      await flush();
      await h.calls[0].onopen({
        ok: false,
        status,
        statusText: "nope",
        json: async () => ({}),
      } as unknown as Response);
      await flush();

      const e = await done;
      expect(e).toBeInstanceOf(StreamDisconnectedError);
      expect(
        (e as InstanceType<typeof StreamDisconnectedError>).retriable,
      ).toBe(retriable);
    }
  });

  test("a backend error event ends the stream without throwing", async () => {
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0), got);
    await flush();

    h.calls[0].onmessage({
      data: JSON.stringify({ type: "error", error: "spawn failed" }),
    });
    await flush();

    // Terminal, and not a disconnect: the turn died, and the caller must not
    // resume it. It reaches the consumer as an ordinary event.
    expect(await done).toBeNull();
    expect(got).toEqual([{ type: "error", error: "spawn failed" }]);
  });
});

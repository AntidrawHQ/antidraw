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

// The call a test is asserting on has always been recorded by the time it
// looks — the generator has been driven past its first flush. Asserted here
// so the assertions below stay about behaviour rather than about indexing.
const call = (i = 0) => h.calls[i]!;

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

    expect(call().url).toBe("antidraw://app/api/chat/abc/stream?afterSeq=12");
    expect(call(1).url).toBe("antidraw://app/api/chat/abc/stream");
  });

  test("a release ends the iteration cleanly and aborts the fetch", async () => {
    const release = new AbortController();
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0, release.signal), got);
    await flush();

    call().onmessage({
      data: JSON.stringify({ type: "state", state: "running" }),
    });
    await flush();
    expect(call().signal.aborted).toBe(false);

    release.abort();
    await flush();

    // Cleanly: the caller asked for this, so there is nothing to report.
    expect(await done).toBeNull();
    expect(got).toEqual([{ type: "state", state: "running" }]);
    // And the fetch is aborted, which is what fires the backend's request
    // abort and detaches its listeners.
    expect(call().signal.aborted).toBe(true);
  });

  test("a release that arrives before the stream opens still ends it", async () => {
    const release = new AbortController();
    release.abort();
    const got: StreamEvent[] = [];

    expect(await drain(subscribeToConversation("abc", 0, release.signal), got))
      .toBeNull();
    expect(got).toEqual([]);
    // Ended before it began: no fetch was ever issued for it.
    expect(h.calls).toHaveLength(0);
  });

  test("a transport error is a retriable disconnect, not an event", async () => {
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0), got);
    await flush();

    call().onmessage({
      data: JSON.stringify({ type: "state", state: "running" }),
    });
    expect(() => call().onerror(new Error("socket closed"))).toThrow();
    await flush();

    const e = await done;
    expect(e).toBeInstanceOf(StreamDisconnectedError);
    expect((e as InstanceType<typeof StreamDisconnectedError>).retriable).toBe(
      true,
    );
    // An event delivered before the failure still reaches the consumer. Note
    // what this does NOT show: drain-before-error. drain() has had a read
    // pending since the flush above, so this event was handed straight to it
    // and never entered the queue. Send a second one in the same burst and it
    // is discarded — controller.error() resets the queue. The subscribe loop's
    // cursor replay is what covers that, not anything here.
    expect(got).toEqual([{ type: "state", state: "running" }]);
  });

  test("a body that ends without a terminal event is a retriable disconnect", async () => {
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0), got);
    await flush();

    // The library closing the body on its own. Nothing said the turn was
    // over, so the caller has something to resume from.
    call().onclose();
    await flush();

    const e = await done;
    expect(e).toBeInstanceOf(StreamDisconnectedError);
    expect((e as InstanceType<typeof StreamDisconnectedError>).retriable).toBe(
      true,
    );
  });

  test("a body that ends after a terminal event ends cleanly", async () => {
    const got: StreamEvent[] = [];
    const done = drain(subscribeToConversation("abc", 0), got);
    await flush();

    call().onmessage({
      data: JSON.stringify({ type: "error", error: "spawn failed" }),
    });
    await flush();
    // The close that follows the terminal event must not be reported as a
    // disconnect: there is nothing left to resume.
    call().onclose();
    await flush();

    expect(await done).toBeNull();
    expect(got).toEqual([{ type: "error", error: "spawn failed" }]);
  });

  test("a 404 on open is not retriable; a 500 is", async () => {
    for (const [status, retriable] of [
      [404, false],
      [500, true],
    ] as const) {
      h.calls.length = 0;
      const done = drain(subscribeToConversation("abc", 0), []);
      await flush();
      await call().onopen({
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

    call().onmessage({
      data: JSON.stringify({ type: "error", error: "spawn failed" }),
    });
    await flush();

    // Terminal, and not a disconnect: the turn died, and the caller must not
    // resume it. It reaches the consumer as an ordinary event.
    expect(await done).toBeNull();
    expect(got).toEqual([{ type: "error", error: "spawn failed" }]);
  });
});

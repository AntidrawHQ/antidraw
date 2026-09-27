import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { PublishEvent } from "@/main/api";
import { cancelPublish, publishWorkspace } from "../api";
import { AccountRequestError, publishMutationOptions } from "../account-ops";

// The real @microsoft/fetch-event-source over a faked fetch, so the SSE body
// arrives in exactly the chunks a test chooses. One network chunk carrying
// several frames fires onmessage once per frame, synchronously — the case
// that used to lose a terminal event queued behind an earlier one.

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

const step = (s: string) => ({ type: "step", step: s });
const buildLog = (line: string) => ({ type: "build-log", line });
const failWith = (code: string) => ({ type: "error", error: { code, message: code } });

let bodies: string[][];

const sseResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
};

beforeEach(() => {
  bodies = [];
  // fetchEventSource reaches for window.fetch/setTimeout and document's
  // visibility listeners; this is a node test environment.
  vi.stubGlobal("window", {
    fetch: vi.fn(async () => sseResponse(bodies.shift() ?? [])),
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const drain = async (gen: AsyncGenerator<PublishEvent>) => {
  const got: unknown[] = [];
  try {
    for await (const e of gen) got.push(e);
    return { got, error: null as unknown };
  } catch (error) {
    return { got, error };
  }
};

describe("publishWorkspace", () => {
  test("a terminal error sharing the last chunk with an earlier frame is delivered", async () => {
    bodies.push([frame(step("checking")) + frame(failWith("PUBLISH_IN_PROGRESS"))]);

    const { got, error } = await drain(publishWorkspace("ws"));

    expect(error).toBeNull();
    expect(got).toEqual([step("checking"), failWith("PUBLISH_IN_PROGRESS")]);
  });

  test("several queued frames before the terminal one are all delivered", async () => {
    bodies.push([
      frame(buildLog("a")) + frame(buildLog("b")) + frame(failWith("BUILD_FAILED")),
    ]);

    const { got, error } = await drain(publishWorkspace("ws"));

    expect(error).toBeNull();
    expect(got).toEqual([buildLog("a"), buildLog("b"), failWith("BUILD_FAILED")]);
  });

  test("the same frames in separate chunks read the same", async () => {
    bodies.push([frame(step("checking")), frame(failWith("PUBLISH_IN_PROGRESS"))]);

    const { got, error } = await drain(publishWorkspace("ws"));

    expect(error).toBeNull();
    expect(got).toEqual([step("checking"), failWith("PUBLISH_IN_PROGRESS")]);
  });

  test("a body that ends without a terminal event errors the stream", async () => {
    bodies.push([frame(step("checking"))]);

    const { got, error } = await drain(publishWorkspace("ws"));

    expect(got).toEqual([step("checking")]);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Connection closed");
  });

  test("the transport's promise never rejects unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      bodies.push([frame(step("checking")) + frame(failWith("BUILD_FAILED"))]);
      await drain(publishWorkspace("ws"));
      bodies.push([frame(step("checking"))]);
      await drain(publishWorkspace("ws"));
      // Unhandled rejections are reported after a macrotask.
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

describe("publishMutationOptions over the real stream", () => {
  const run = async () => {
    const { mutationFn } = publishMutationOptions(new QueryClient());
    try {
      await mutationFn({ workspaceId: "ws" });
      return null;
    } catch (e) {
      return e as AccountRequestError;
    }
  };

  test("PUBLISH_IN_PROGRESS arriving in one chunk with its step is that error, not lost contact", async () => {
    bodies.push([frame(step("checking")) + frame(failWith("PUBLISH_IN_PROGRESS"))]);

    const error = await run();

    expect(error).toBeInstanceOf(AccountRequestError);
    expect(error?.code).toBe("PUBLISH_IN_PROGRESS");
  });

  test("a lost connection says to publish again, the one action the panel offers", async () => {
    bodies.push([frame(step("building"))]);

    const error = await run();

    expect(error?.code).toBe("INTERNAL_ERROR");
    expect(error?.message).toBe("The connection to the publish was lost. Publish again.");
  });
});

describe("cancelPublish", () => {
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  test("carries main's verdict: false when it had no run to cancel", async () => {
    answer(200, { cancelled: false });
    const result = await cancelPublish("ws");
    expect(result.isOk() && result.value).toBe(false);
  });

  test("true when main aborted the run", async () => {
    answer(200, { cancelled: true });
    const result = await cancelPublish("ws");
    expect(result.isOk() && result.value).toBe(true);
  });

  test("an error status is an error, not a sent cancel", async () => {
    answer(400, { error: { code: "VALIDATION_ERROR", message: "bad id" } });
    const result = await cancelPublish("ws");
    expect(result.isErr()).toBe(true);
  });
});

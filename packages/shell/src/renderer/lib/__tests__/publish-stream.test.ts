// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, expect, test, vi } from "vitest";
import type { PublishStreamEvent } from "@/main/api";

// publishWorkspace over the real fetch-event-source, with main's SSE response
// faked at fetch. The body ending runs both of the library's endings (onclose,
// then onerror with onclose's throw); events still queued when it does must
// reach the reader.

(window as { electronAPI?: unknown }).electronAPI = { appKey: "the-app-key" };
const { publishWorkspace } = await import("../api");

const sse = (...events: PublishStreamEvent[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

/** A response with this body, in one chunk or cut at these byte offsets, then its end. */
const respond = (body: string, cuts: number[] = []) => {
  const bytes = new TextEncoder().encode(body);
  const at = [...new Set(cuts.map((cut) => cut % (bytes.length + 1)))].sort((a, b) => a - b);
  const chunks = [0, ...at].map((from, i) => bytes.slice(from, [...at, bytes.length][i]));
  return vi.spyOn(window, "fetch").mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) if (chunk.length) controller.enqueue(chunk);
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
};

/** Reads like the store does: a step's work between events (or, `waits` says, none). */
const read = async (workspaceId: string, waits: boolean[] = [true]) => {
  const got: PublishStreamEvent[] = [];
  try {
    for await (const event of publishWorkspace(workspaceId)) {
      if (waits[got.length % waits.length]) await new Promise((resolve) => setTimeout(resolve, 0));
      got.push(event);
    }
    return { got, ended: "closed" };
  } catch (error) {
    return { got, ended: (error as Error).message };
  }
};

afterEach(() => vi.restoreAllMocks());

test("a failure in the last chunk reaches the reader, with the logs before it", async () => {
  const events: PublishStreamEvent[] = [
    { type: "step", step: "build" },
    ...[0, 1, 2, 3, 4].map((i): PublishStreamEvent => ({ type: "log", line: `x${i}` })),
    { type: "error", code: "BUILD_FAILED", message: "Couldn't build the workspace.\nerror during build:" },
  ];
  respond(sse(...events));

  expect(await read("w1")).toEqual({ got: events, ended: "closed" });
});

test("a stream that ends without saying how reads as closed, with what it said", async () => {
  respond(sse({ type: "step", step: "runtime" }));

  expect(await read("w1")).toEqual({ got: [{ type: "step", step: "runtime" }], ended: "closed" });
});

test("posts to the workspace's publish route with the app key", async () => {
  const fetch = respond(sse({ type: "done", url: "https://antidraw.site/s/a" }));
  await read("w1");

  const [url, init] = fetch.mock.calls[0]!;
  expect([url, init?.method, (init?.headers as Record<string, string>)["x-antidraw-app-key"]]).toEqual([
    "antidraw://app/api/workspaces/w1/publish",
    "POST",
    "the-app-key",
  ]);
});

// Lines as vite writes them: any text, the user's file names and emoji among it.
const text = fc.string({ unit: "grapheme", maxLength: 40 });
const event: fc.Arbitrary<PublishStreamEvent> = fc.oneof(
  fc.constantFrom(...(["runtime", "build", "upload", "live"] as const)).map((step): PublishStreamEvent => ({ type: "step", step })),
  text.map((line): PublishStreamEvent => ({ type: "log", line })),
  fc.record({ step: fc.constantFrom(...(["runtime", "build", "upload"] as const)), text }).map((m): PublishStreamEvent => ({ type: "meta", ...m })),
  fc
    .record({ done: fc.nat(50), total: fc.nat(50), unchanged: fc.nat(50), file: text })
    .map((u): PublishStreamEvent => ({ type: "upload", ...u })),
);
// How a run ends: live, failed with a message over several lines, or not at all.
const ending: fc.Arbitrary<PublishStreamEvent[]> = fc.oneof(
  fc.constant<PublishStreamEvent[]>([]),
  fc.constant<PublishStreamEvent[]>([{ type: "done", url: "https://antidraw.site/s/a" }]),
  fc
    .array(text, { minLength: 1, maxLength: 4 })
    .map((lines): PublishStreamEvent[] => [{ type: "error", code: "BUILD_FAILED", message: lines.join("\n") }]),
);

test("every event reaches the reader in order, however the body is cut and however fast it reads", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(event, { maxLength: 30 }),
      ending,
      fc.array(fc.nat(), { maxLength: 12 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
      async (events, end, cuts, waits) => {
        const all = [...events, ...end];
        respond(sse(...all), cuts);
        const { got, ended } = await read("w1", waits);
        vi.restoreAllMocks();
        expect(ended).toBe("closed");
        expect(got).toEqual(all);
      },
    ),
    { numRuns: 150 },
  );
});

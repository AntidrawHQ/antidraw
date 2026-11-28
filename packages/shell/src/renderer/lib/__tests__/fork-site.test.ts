import { expect, test, vi } from "vitest";
import type { ForkSiteResponse } from "@/main/api";

// Cancelling a fork, the renderer's half: the signal has to abort the event
// stream's fetch, which is what main hears as the cancel (the route's
// onAbort, fork-cancel.test.ts), and end the events, which fetchEventSource
// doesn't do itself once aborted. Mocked at the library's boundary.
const h = vi.hoisted(() => ({
  calls: [] as {
    url: string;
    body: string;
    signal: AbortSignal;
    onmessage: (ev: { data: string }) => void;
  }[],
}));

vi.mock("@microsoft/fetch-event-source", () => ({
  // As the library does: an abort ends it quietly, with neither callback.
  fetchEventSource: (url: string, opts: Record<string, unknown>) => {
    h.calls.push({ url, ...opts } as (typeof h.calls)[number]);
    return new Promise(() => {});
  },
}));

vi.stubGlobal("window", { electronAPI: { appKey: "the-app-key" } });

const { forkSite } = await import("../api");

test("cancelling a fork lets go of its stream, and ends its events", async () => {
  const cancel = new AbortController();
  const events = forkSite("site-1", cancel.signal);
  const first = events.next();
  const call = h.calls.at(-1)!;
  call.onmessage({ data: JSON.stringify({ type: "status", status: "FETCHING_SOURCE" }) });
  const seen: ForkSiteResponse[] = [(await first).value as ForkSiteResponse];

  const rest = (async () => {
    for await (const event of events) seen.push(event);
  })();
  cancel.abort();

  expect({
    asked: { url: call.url, body: JSON.parse(call.body) },
    seen,
    ended: await rest.then(
      () => "without an error",
      (error: unknown) => (error instanceof DOMException ? error.name : String(error)),
    ),
    letGo: call.signal.aborted,
  }).toEqual({
    asked: { url: "antidraw://app/api/workspaces/fork", body: { siteId: "site-1" } },
    seen: [{ type: "status", status: "FETCHING_SOURCE" }],
    ended: "AbortError",
    letGo: true,
  });
});

test("a fork cancelled before it started never asks", async () => {
  const cancel = new AbortController();
  cancel.abort();
  const before = h.calls.length;
  await expect(forkSite("site-1", cancel.signal).next()).rejects.toMatchObject({ name: "AbortError" });
  expect(h.calls.length).toBe(before);
});

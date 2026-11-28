import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { describe, expect, test, vi } from "vitest";
import { withAppKey } from "./with-app-key";

// Cancelling a fork is the renderer letting go of its event stream. Like the
// conversation stream (stream-resume.test.ts), the route hears that two ways:
// the response body being cancelled, which is what happens under Electron's
// protocol.handle, and the request's signal, which is what happens anywhere
// else. Either has to reach the fork as its signal.

const h = vi.hoisted(() => ({
  signals: [] as AbortSignal[],
}));

// The fork as main runs it, stalled on its first step until it's cancelled.
vi.mock("@/main/services/fork.service", () => ({
  async *forkPublishedSite(_siteId: string, signal: AbortSignal) {
    h.signals.push(signal);
    yield { type: "status", status: "FETCHING_SOURCE" };
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    yield { type: "error", error: { code: "CANCELLED", message: "The fork was cancelled." } };
  },
}));

const { workspaceController } = await import("@/main/api/controllers/workspace.controller");

const open = async (init: RequestInit = {}) => {
  const res = await workspaceController.request(
    "/fork",
    withAppKey({
      ...init,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: "site-1" }),
    }),
  );
  const reader = res.body!.getReader();
  await reader.read(); // its first step: the fork is under way
  return { reader, signal: h.signals.at(-1)! };
};

const stopped = (signal: AbortSignal) =>
  vi.waitFor(() => expect(signal.aborted).toBe(true), { timeout: 1000 });

describe("cancelling a fork", () => {
  test("letting go of the response body stops it", async () => {
    const { reader, signal } = await open();
    expect(signal.aborted).toBe(false);
    await reader.cancel();
    await stopped(signal);
  });

  test("aborting the request stops it too", async () => {
    const abort = new AbortController();
    const { reader, signal } = await open({ signal: abort.signal });
    abort.abort();
    await stopped(signal);
    await reader.cancel().catch(() => {});
  });
});

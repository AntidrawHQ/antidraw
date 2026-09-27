import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ok, err } from "neverthrow";
import type { PublishEvent, PublishResult, SiteStatus } from "@/main/api";
import { queryKeys } from "../query-keys";

// Only the HTTP calls are faked; the store, the mutation options and the
// query options are the real ones.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    publishWorkspace: vi.fn(),
    getPublishStatus: vi.fn(),
    getPublishSession: vi.fn(),
    cancelPublish: vi.fn(),
  };
});

const api = await import("../api");
const {
  usePublishRuns,
  startPublish,
  cancelPublishRun,
  canCancelPublish,
  CANCEL_ARM_MS,
  checkPublishStatus,
  dismissPublishRun,
  judgeOutcome,
} = await import("../publish-runs");
const { publishStatusQueryOptions } = await import("../account-ops");

const mockPublish = vi.mocked(api.publishWorkspace);
const mockStatus = vi.mocked(api.getPublishStatus);
const mockCancel = vi.mocked(api.cancelPublish);
const mockSession = vi.mocked(api.getPublishSession);

// A publish stream the test feeds event by event, like main's SSE. Events
// pushed before the publish opens it (the mutation starts it a tick later)
// wait in its queue.
type Channel = { queue: PublishEvent[]; wake: (() => void) | null };
const channels = new Map<string, Channel>();
const channel = (workspaceId: string) => {
  let c = channels.get(workspaceId);
  if (!c) {
    c = { queue: [], wake: null };
    channels.set(workspaceId, c);
  }
  return c;
};
const push = (workspaceId: string, e: PublishEvent) => {
  const c = channel(workspaceId);
  c.queue.push(e);
  c.wake?.();
  c.wake = null;
};
async function* openStream(workspaceId: string): AsyncGenerator<PublishEvent> {
  const c = channel(workspaceId);
  for (;;) {
    while (c.queue.length > 0) {
      const e = c.queue.shift()!;
      yield e;
      if (e.type === "done" || e.type === "error") {
        channels.delete(workspaceId);
        return;
      }
    }
    await new Promise<void>((resolve) => (c.wake = resolve));
  }
}

const site = (workspaceId: string, headVersion: number, allowRemix = true): SiteStatus => ({
  siteId: `site-${workspaceId}`,
  slug: workspaceId,
  url: `https://${workspaceId}.example.test`,
  headVersion,
  allowRemix,
  lastPublishedAt: null,
});

const resultFor = (workspaceId: string, version: number): PublishResult => ({
  url: `https://${workspaceId}.example.test`,
  slug: workspaceId,
  version,
  allowRemix: true,
  status: site(workspaceId, version),
  snapshot: { fileCount: 1, archiveBytes: 1, largeFileCount: 0, snapshotBytes: 1 },
  site: { fileCount: 1, uploadedFiles: 1, skipped: [] },
  excluded: { listed: [], grouped: [] } as unknown as PublishResult["excluded"],
  notes: [],
});

const fail = (code: string) =>
  ({ type: "error", error: { code, message: code } }) as PublishEvent;

const runOf = (workspaceId: string) => usePublishRuns.getState().runs[workspaceId];

// Server-side site versions, per workspace, as GET /api/publish/:ws answers.
let heads: Record<string, number | "error">;
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  usePublishRuns.setState({ runs: {} });
  channels.clear();
  heads = {};
  // The app's QueryClient keeps the default of 3 retries.
  queryClient = new QueryClient();
  mockPublish.mockImplementation((workspaceId) => openStream(workspaceId));
  mockStatus.mockImplementation(async (workspaceId) => {
    const head = heads[workspaceId];
    if (head === "error") {
      return err({ status: 500 as const, code: "NETWORK_ERROR", message: "down" });
    }
    return ok(head === undefined ? null : site(workspaceId, head));
  });
  mockCancel.mockImplementation(async (workspaceId) => {
    push(workspaceId, fail("CANCELLED"));
    return ok(true);
  });
});

describe("runs belong to the workspace they were started for", () => {
  test("a publish of A finishing while B is publishing lands on A only", async () => {
    const a = startPublish(queryClient, "A");
    const b = startPublish(queryClient, "B");
    push("B", { type: "step", step: "building" });
    push("A", { type: "done", result: resultFor("A", 1) });

    expect(await a).toBe("published");
    expect(runOf("A")).toMatchObject({ phase: "published", url: "https://A.example.test" });
    await vi.waitFor(() =>
      expect(runOf("B")).toMatchObject({ phase: "publishing", progress: { step: "building" } }),
    );

    push("B", fail("BUILD_FAILED"));
    expect(await b).toBe("failed");
    expect(runOf("A")?.phase).toBe("published");
    expect(runOf("B")).toMatchObject({ phase: "failed", error: { code: "BUILD_FAILED" } });
    expect(queryClient.getQueryData(queryKeys.publish.status("A"))).toMatchObject({
      headVersion: 1,
    });
  });

  test("Check status for A reads A's site, not the active workspace's", async () => {
    heads = { A: 1, B: 5 };
    const a = startPublish(queryClient, "A");
    push("A", fail("PUBLISH_OUTCOME_UNKNOWN"));
    await a;

    await checkPublishStatus(queryClient, "A");
    expect(mockStatus.mock.calls.every(([ws]) => ws === "A")).toBe(true);
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "pending" });
  });

  test("dismissing one workspace's panel leaves the others", async () => {
    const a = startPublish(queryClient, "A");
    push("A", fail("BUILD_FAILED"));
    await a;
    void startPublish(queryClient, "B");

    dismissPublishRun("A");
    dismissPublishRun("B"); // in flight: stays

    expect(runOf("A")).toBeUndefined();
    expect(runOf("B")?.phase).toBe("publishing");
  });
});

describe("the failure panel is not held in 'Checking…' by the status refetch", () => {
  test("a failed publish is not checking, even while the status is refetched and failing", async () => {
    heads = { A: "error" };
    const a = startPublish(queryClient, "A");
    push("A", fail("SERVER_UNREACHABLE"));
    await a;

    // The hook-level onError invalidated the status; nothing marks the run
    // as checking because of it.
    expect(runOf("A")).toMatchObject({ phase: "failed", checking: false });
  });

  test("Check status is checking only while it runs, and gives up without retries", async () => {
    heads = { A: 1 };
    const a = startPublish(queryClient, "A");
    push("A", fail("PUBLISH_OUTCOME_UNKNOWN"));
    await a;

    heads = { A: "error" };
    const calls = mockStatus.mock.calls.length;
    const checking = checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ checking: true });
    await checking;
    expect(mockStatus.mock.calls.length - calls).toBe(1);
    expect(runOf("A")).toMatchObject({ phase: "failed", checking: false, check: "failed" });
  });

  test("the status query retries at most once", () => {
    expect(publishStatusQueryOptions("A").retry).toBe(1);
  });
});

describe("Check status compares against the version read when the publish started", () => {
  test("an older head that was never in the cache does not count as this publish landing", async () => {
    // Signed out a moment ago: the status query never ran, nothing is cached.
    heads = { A: 2 };
    const a = startPublish(queryClient, "A");
    push("A", fail("PUBLISH_OUTCOME_UNKNOWN"));
    await a;

    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "pending" });

    // The session commits: head moves past the baseline.
    heads = { A: 3 };
    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({
      phase: "published",
      url: "https://A.example.test",
      result: null,
    });
  });

  test("a stale cached status is not used as the baseline", async () => {
    queryClient.setQueryData(queryKeys.publish.status("A"), site("A", 0));
    heads = { A: 2 };
    const a = startPublish(queryClient, "A");
    push("A", fail("PUBLISH_OUTCOME_UNKNOWN"));
    await a;

    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "pending" });
  });

  test("a baseline that could not be read is 'can't tell', never 'published'", async () => {
    heads = { A: "error" };
    const a = startPublish(queryClient, "A");
    push("A", fail("PUBLISH_OUTCOME_UNKNOWN"));
    await a;

    heads = { A: 7 };
    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "unknown" });
  });

  test("judgeOutcome", () => {
    expect(judgeOutcome(null, site("A", 9))).toBe("unknown");
    expect(judgeOutcome(0, null)).toBe("pending");
    expect(judgeOutcome(2, site("A", 2))).toBe("pending");
    expect(judgeOutcome(2, site("A", 3))).toBe("live");
  });
});

describe("Check status asks about the session when main names it", () => {
  const unknownWith = (publishId: string) =>
    ({
      type: "error",
      error: { code: "PUBLISH_OUTCOME_UNKNOWN", message: "m", details: { publishId } },
    }) as PublishEvent;

  test("pending, then completed: the session's answer decides, not the head version", async () => {
    heads = { A: 2 };
    const a = startPublish(queryClient, "A");
    push("A", unknownWith("pub_9"));
    await a;

    // Someone else's publish moved the head; this session is still pending.
    heads = { A: 5 };
    mockSession.mockResolvedValueOnce(ok({ status: "pending", resultVersion: null, site: site("A", 5) }));
    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "pending", checking: false });
    expect(mockSession).toHaveBeenLastCalledWith("A", "pub_9");

    mockSession.mockResolvedValueOnce(ok({ status: "completed", resultVersion: 6, site: site("A", 6) }));
    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "published", url: "https://A.example.test", result: null });
    expect(queryClient.getQueryData(queryKeys.publish.status("A"))).toEqual(site("A", 6));
  });

  test("an expired session is 'ended', even when the head moved", async () => {
    heads = { A: 1 };
    const a = startPublish(queryClient, "A");
    push("A", unknownWith("pub_9"));
    await a;

    mockSession.mockResolvedValueOnce(ok({ status: "expired", resultVersion: null, site: site("A", 4) }));
    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "ended" });
  });

  test("a session that can't be read now is 'failed'", async () => {
    const a = startPublish(queryClient, "A");
    push("A", unknownWith("pub_9"));
    await a;

    mockSession.mockResolvedValueOnce(err({ status: 502 as 500, code: "SERVER_UNREACHABLE", message: "down" }));
    await checkPublishStatus(queryClient, "A");
    expect(runOf("A")).toMatchObject({ phase: "failed", check: "failed", checking: false });
  });
});

describe("cancel", () => {
  // Cancel is armed CANCEL_ARM_MS after the run starts.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const armCancel = () => vi.advanceTimersByTimeAsync(CANCEL_ARM_MS);

  test("cancelling asks main to cancel this workspace's run, which then ends", async () => {
    const a = startPublish(queryClient, "A");
    push("A", { type: "step", step: "building" });
    await vi.waitFor(() => expect(runOf("A")).toMatchObject({ progress: { step: "building" } }));
    await armCancel();

    await cancelPublishRun("A");
    expect(mockCancel).toHaveBeenCalledWith("A");
    expect(await a).toBe("cancelled");
    expect(runOf("A")).toBeUndefined();
  });

  test("the run shows it is cancelling until the stream ends", async () => {
    mockCancel.mockResolvedValueOnce(ok(true));
    const a = startPublish(queryClient, "A");
    push("A", { type: "step", step: "uploading" });
    await vi.waitFor(() => expect(runOf("A")).toMatchObject({ progress: { step: "uploading" } }));
    await armCancel();

    await cancelPublishRun("A");
    expect(runOf("A")).toMatchObject({ phase: "publishing", cancelling: true });
    await cancelPublishRun("A"); // a second click sends nothing more
    expect(mockCancel).toHaveBeenCalledTimes(1);

    push("A", fail("CANCELLED"));
    expect(await a).toBe("cancelled");
  });

  test("once finishing, cancel is not offered (main would ignore it)", async () => {
    const a = startPublish(queryClient, "A");
    push("A", { type: "step", step: "finishing" });
    await vi.waitFor(() => expect(runOf("A")).toMatchObject({ progress: { step: "finishing" } }));
    await armCancel();

    expect(canCancelPublish(runOf("A"))).toBe(false);
    await cancelPublishRun("A");
    expect(mockCancel).not.toHaveBeenCalled();

    push("A", { type: "done", result: resultFor("A", 1) });
    expect(await a).toBe("published");
  });

  test("a cancel that loses the race with finishing clears 'cancelling'", async () => {
    mockCancel.mockResolvedValueOnce(ok(true));
    const a = startPublish(queryClient, "A");
    await armCancel();
    await cancelPublishRun("A");
    expect(runOf("A")).toMatchObject({ cancelling: true });

    push("A", { type: "step", step: "finishing" });
    await vi.waitFor(() =>
      expect(runOf("A")).toMatchObject({ progress: { step: "finishing" }, cancelling: false }),
    );
    push("A", { type: "done", result: resultFor("A", 1) });
    expect(await a).toBe("published");
  });

  test("a double-click on Publish does not cancel what its first click started", async () => {
    const a = startPublish(queryClient, "A");
    // The second click lands on the same button, now showing the run.
    expect(canCancelPublish(runOf("A"))).toBe(false);
    await cancelPublishRun("A");
    await vi.advanceTimersByTimeAsync(CANCEL_ARM_MS - 1);
    await cancelPublishRun("A");
    expect(mockCancel).not.toHaveBeenCalled();
    expect(runOf("A")).toMatchObject({ phase: "publishing", cancelling: false });

    await vi.advanceTimersByTimeAsync(1);
    expect(canCancelPublish(runOf("A"))).toBe(true);

    push("A", { type: "done", result: resultFor("A", 1) });
    expect(await a).toBe("published");
  });

  test("a cancel main had nothing to act on does not leave the run 'cancelling'", async () => {
    // Main answers false: its run was not registered yet, or already finishing.
    mockCancel.mockResolvedValueOnce(ok(false));
    const a = startPublish(queryClient, "A");
    await armCancel();

    await cancelPublishRun("A");
    expect(mockCancel).toHaveBeenCalledWith("A");
    expect(runOf("A")).toMatchObject({ phase: "publishing", cancelling: false });
    expect(canCancelPublish(runOf("A"))).toBe(true);

    push("A", { type: "done", result: resultFor("A", 1) });
    expect(await a).toBe("published");
  });

  test("a failed cancel request clears 'cancelling' too", async () => {
    mockCancel.mockResolvedValueOnce(
      err({ status: 500 as const, code: "NETWORK_ERROR", message: "down" }),
    );
    const a = startPublish(queryClient, "A");
    await armCancel();

    await cancelPublishRun("A");
    expect(runOf("A")).toMatchObject({ phase: "publishing", cancelling: false });

    push("A", { type: "done", result: resultFor("A", 1) });
    expect(await a).toBe("published");
  });

  test("a cancel after uploads started keeps the run, so the panel can warn about public files", async () => {
    mockCancel.mockImplementationOnce(async (workspaceId) => {
      push(workspaceId, {
        type: "error",
        error: {
          code: "CANCELLED",
          message: "Publishing was cancelled.",
          details: { publicFilesMayHaveChanged: true },
        },
      } as PublishEvent);
      return ok(true);
    });
    const a = startPublish(queryClient, "A");
    push("A", { type: "upload-progress", uploadedBytes: 60, totalBytes: 100 } as PublishEvent);
    await vi.waitFor(() =>
      expect(runOf("A")).toMatchObject({ progress: { step: "uploading", percent: 60 } }),
    );
    await armCancel();

    await cancelPublishRun("A");
    expect(await a).toBe("cancelled");
    expect(runOf("A")).toMatchObject({
      phase: "failed",
      error: { code: "CANCELLED", details: { publicFilesMayHaveChanged: true } },
    });
  });

  test("signed out after uploads started keeps the run too", async () => {
    const a = startPublish(queryClient, "A");
    push("A", {
      type: "error",
      error: { code: "SIGNED_OUT", message: "m", details: { publicFilesMayHaveChanged: true } },
    } as PublishEvent);
    expect(await a).toBe("signed-out");
    expect(runOf("A")).toMatchObject({
      phase: "failed",
      error: { code: "SIGNED_OUT", details: { publicFilesMayHaveChanged: true } },
    });
  });

  test("signed out before any upload ends the run quietly", async () => {
    const a = startPublish(queryClient, "A");
    push("A", fail("SIGNED_OUT"));
    expect(await a).toBe("signed-out");
    expect(runOf("A")).toBeUndefined();
  });

  test("a second start while one is in flight does not start another", async () => {
    void startPublish(queryClient, "A");
    expect(await startPublish(queryClient, "A")).toBe("already-publishing");
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";
import { Hono } from "hono";
import { err, ok } from "neverthrow";
import { cloudFetch, getAccount } from "@/main/services/account.service";
import { publishController } from "@/main/api/controllers/publish.controller";
import * as publishService from "@/main/services/publish/publish.service";
import type { PublishEvent } from "@/main/services/publish/types";

// The real service and cloud client run underneath; only what reaches
// outside the process (the cloud, the DB, the build, the file system under
// ~/.antidraw) is stubbed.
vi.mock("@/main/services/account.service", () => ({
  cloudFetch: vi.fn(),
  getAccount: vi.fn(),
}));
vi.mock("@/main/api/init", () => ({
  getAntidrawRoot: () => "/nonexistent-antidraw-root",
  getWorkspaceSourcePath: (id: string) => `/nonexistent-antidraw-root/workspaces/${id}/source`,
}));
vi.mock("@/main/api/services/workspace.service", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/main/api/services/chat.service", () => ({ listConversations: vi.fn() }));
vi.mock("@/main/services/publish/site-builder", () => ({ buildWorkspaceSite: vi.fn() }));
vi.mock("@/main/lib/snapshot", () => ({
  MAX_SNAPSHOT_BYTES: 500 * 1024 * 1024,
  MAX_UNCOMPRESSED_BYTES: 1000 * 1024 * 1024,
  MAX_SNAPSHOT_FILES: 100_000,
  scanWorkspace: vi.fn(),
  stageSnapshot: vi.fn(),
  packSnapshot: vi.fn(),
  largestFiles: vi.fn(() => []),
}));

const WS = "8b0b7b5e-3f4c-4d57-9a55-2c1f2b0e8c11";

const site = {
  siteId: "site_abc",
  slug: "my-canvas-x7k2p",
  url: "https://my-canvas-x7k2p.antidraw.app",
  headVersion: 2,
  allowRemix: true,
  lastPublishedAt: "2026-09-27T10:00:00.000Z",
};

const app = new Hono().route("/api/publish", publishController);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const signedOut = () =>
  err({ status: 401 as const, code: "SIGNED_OUT" as const, message: "Not signed in" });

// SSE frames → the JSON each `data:` line carries.
const readEvents = async (res: Response) =>
  (await res.text())
    .split("\n\n")
    .filter((frame) => frame.trim() !== "")
    .map((frame) => {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n");
      return JSON.parse(data) as PublishEvent;
    });

describe("publish controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  test("POST streams PublishEvents as SSE frames", async () => {
    vi.mocked(getAccount).mockResolvedValue(ok(null));

    const res = await app.request(`/api/publish/${WS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await readEvents(res)).toEqual([
      { type: "step", step: "checking" },
      { type: "error", error: { code: "SIGNED_OUT", message: "Sign in to publish." } },
    ]);
  });

  test("POST passes allowRemix through only when it is sent", async () => {
    const calls: Parameters<typeof publishService.publishWorkspace>[] = [];
    vi.spyOn(publishService, "publishWorkspace").mockImplementation(async function* (...args) {
      calls.push(args);
      yield { type: "step", step: "checking" } satisfies PublishEvent;
    });

    for (const body of ["{}", JSON.stringify({ allowRemix: false })]) {
      const res = await app.request(`/api/publish/${WS}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      await res.text();
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe(WS);
    expect(calls[0]![1]).not.toHaveProperty("allowRemix");
    expect(calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]![1]).toHaveProperty("allowRemix", false);
  });

  test("POST rejects a bad workspace id and a bad body", async () => {
    const badId = await app.request("/api/publish/not-a-uuid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(badId.status).toBe(400);

    const badBody = await app.request(`/api/publish/${WS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowRemix: "yes" }),
    });
    expect(badBody.status).toBe(400);
  });

  test("GET while signed out answers { site: null }", async () => {
    vi.mocked(cloudFetch).mockResolvedValue(signedOut());

    const res = await app.request(`/api/publish/${WS}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site: null });
  });

  test("GET answers the site status", async () => {
    vi.mocked(cloudFetch).mockResolvedValue(ok(json({ site })));

    const res = await app.request(`/api/publish/${WS}`);

    expect(await res.json()).toEqual({ site });
    expect(vi.mocked(cloudFetch).mock.calls[0]![0]).toBe(
      `/api/publish/sites?clientWorkspaceId=${WS}`,
    );
  });

  test("GET maps a server failure to the error envelope", async () => {
    vi.mocked(cloudFetch).mockResolvedValue(
      ok(json({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500)),
    );

    const res = await app.request(`/api/publish/${WS}`);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        code: "SERVER_ERROR",
        message: "The AntiDraw server had a problem. Try again in a moment.",
        details: { serverCode: "INTERNAL_ERROR" },
      },
    });
  });

  test("PATCH sets allowRemix on the workspace's site", async () => {
    vi.mocked(cloudFetch)
      .mockResolvedValueOnce(ok(json({ site })))
      .mockResolvedValueOnce(ok(json({ site: { ...site, allowRemix: false } })));

    const res = await app.request(`/api/publish/${WS}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowRemix: false }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site: { ...site, allowRemix: false } });
    const [pathname, init] = vi.mocked(cloudFetch).mock.calls[1]!;
    expect(pathname).toBe("/api/publish/sites/site_abc");
    expect(init?.method).toBe("PATCH");
  });

  test("PATCH while signed out is a 401 envelope", async () => {
    vi.mocked(cloudFetch).mockResolvedValue(signedOut());

    const res = await app.request(`/api/publish/${WS}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowRemix: true }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "SIGNED_OUT", message: "Not signed in" },
    });
  });

  test("PATCH requires a boolean allowRemix", async () => {
    const res = await app.request(`/api/publish/${WS}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("GET session answers what became of a publish session", async () => {
    vi.mocked(cloudFetch).mockResolvedValue(
      ok(json({ status: "completed", resultVersion: 3, site: { ...site, headVersion: 3 } })),
    );

    const res = await app.request(`/api/publish/${WS}/session/pub_1`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "completed",
      resultVersion: 3,
      site: { ...site, headVersion: 3 },
    });
    expect(vi.mocked(cloudFetch).mock.calls[0]![0]).toBe("/api/publish/sessions/pub_1");
  });

  test("GET session while signed out is a 401 envelope", async () => {
    vi.mocked(cloudFetch).mockResolvedValue(signedOut());

    const res = await app.request(`/api/publish/${WS}/session/pub_1`);

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("SIGNED_OUT");
  });

  test("cancel cancels the run and answers whether there was one", async () => {
    const cancel = vi.spyOn(publishService, "cancelPublish");

    const idle = await app.request(`/api/publish/${WS}/cancel`, { method: "POST" });

    expect(idle.status).toBe(200);
    expect(await idle.json()).toEqual({ cancelled: false });
    expect(cancel).toHaveBeenCalledWith(WS);

    cancel.mockReturnValueOnce(true);
    const running = await app.request(`/api/publish/${WS}/cancel`, { method: "POST" });

    expect(running.status).toBe(200);
    expect(await running.json()).toEqual({ cancelled: true });
  });
});

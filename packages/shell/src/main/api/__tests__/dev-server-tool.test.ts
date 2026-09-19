import { describe, test, expect, vi, beforeEach } from "vitest";
import { ok, err } from "neverthrow";

vi.mock("@/main/services/dev-server.service", () => ({
  getDevServerStatus: vi.fn(),
}));

import { getDevServerStatus } from "@/main/services/dev-server.service";
import { getDevServerInfo } from "@/main/api/tools/dev-server";

const mockStatus = vi.mocked(getDevServerStatus);

describe("getDevServerInfo", () => {
  beforeEach(() => mockStatus.mockReset());

  test("running server reports url built from the stored port", () => {
    mockStatus.mockReturnValue(
      ok({ workspaceId: "ws", pid: 1, port: 5173, startedAt: 42, running: true })
    );
    expect(getDevServerInfo("ws")).toEqual({
      status: "running",
      url: "http://localhost:5173",
      port: 5173,
      startedAt: 42,
    });
    expect(mockStatus).toHaveBeenCalledWith("ws");
  });

  test("no stored server reports stopped", () => {
    mockStatus.mockReturnValue(
      err({ status: 404, code: "NOT_RUNNING", message: "" })
    );
    expect(getDevServerInfo("ws")).toEqual({ status: "stopped", url: null });
  });

  test("stale entry (pid dead) reports stopped without leaking the port", () => {
    mockStatus.mockReturnValue(
      ok({ workspaceId: "ws", pid: 1, port: 5173, startedAt: 42, running: false })
    );
    expect(getDevServerInfo("ws")).toEqual({ status: "stopped", url: null });
  });
});

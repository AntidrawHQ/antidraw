import { describe, test, expect, vi, beforeEach } from "vitest";
import { ok, err } from "neverthrow";
import fs from "node:fs";

vi.mock("@/main/services/dev-server.service", () => ({
  getDevServerStatus: vi.fn(),
}));

import { getDevServerStatus } from "@/main/services/dev-server.service";
import { getWorkspaceDevServerLogPath } from "@/main/api/init";
import { getDevServerInfo } from "@/main/api/tools/dev-server";

const mockStatus = vi.mocked(getDevServerStatus);
const existsSpy = vi.spyOn(fs, "existsSync");
const logPath = getWorkspaceDevServerLogPath("ws");

describe("getDevServerInfo", () => {
  beforeEach(() => {
    mockStatus.mockReset();
    existsSpy.mockReset().mockReturnValue(true);
  });

  test("running server reports url built from the stored port", () => {
    mockStatus.mockReturnValue(
      ok({ workspaceId: "ws", pid: 1, port: 5173, startedAt: 42, running: true })
    );
    expect(getDevServerInfo("ws")).toEqual({
      status: "running",
      url: "https://localhost:5173",
      port: 5173,
      startedAt: 42,
      logPath,
    });
    expect(mockStatus).toHaveBeenCalledWith("ws");
  });

  test("no stored server reports stopped, still with the log path", () => {
    mockStatus.mockReturnValue(
      err({ status: 404, code: "NOT_RUNNING", message: "" })
    );
    expect(getDevServerInfo("ws")).toEqual({
      status: "stopped",
      url: null,
      logPath,
    });
  });

  test("stale entry (pid dead) reports stopped without leaking the port", () => {
    mockStatus.mockReturnValue(
      ok({ workspaceId: "ws", pid: 1, port: 5173, startedAt: 42, running: false })
    );
    expect(getDevServerInfo("ws")).toMatchObject({ status: "stopped", url: null });
  });

  test("logPath is null when the server has never been started", () => {
    existsSpy.mockReturnValue(false);
    mockStatus.mockReturnValue(
      err({ status: 404, code: "NOT_RUNNING", message: "" })
    );
    expect(getDevServerInfo("ws").logPath).toBeNull();
  });
});

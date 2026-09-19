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
const stored = { workspaceId: "ws", pid: 1, port: 5173, startedAt: 42 };

describe("getDevServerInfo", () => {
  beforeEach(() => {
    mockStatus.mockReset();
    existsSpy.mockReset().mockReturnValue(true);
  });

  test("passes the service state through, adding url and logPath", () => {
    mockStatus.mockReturnValue(ok({ ...stored, running: true }));
    expect(getDevServerInfo("ws")).toEqual({
      ...stored,
      running: true,
      url: "https://localhost:5173",
      logPath,
    });
    expect(mockStatus).toHaveBeenCalledWith("ws");
  });

  test("stale entry (pid dead) keeps its port/url so the disparity is visible", () => {
    mockStatus.mockReturnValue(ok({ ...stored, running: false }));
    expect(getDevServerInfo("ws")).toEqual({
      ...stored,
      running: false,
      url: "https://localhost:5173",
      logPath,
    });
  });

  test("no stored server: running false, log path still reported", () => {
    mockStatus.mockReturnValue(
      err({ status: 404, code: "NOT_RUNNING", message: "" })
    );
    expect(getDevServerInfo("ws")).toEqual({ running: false, logPath });
  });

  test("logPath is null when the server has never been started", () => {
    existsSpy.mockReturnValue(false);
    mockStatus.mockReturnValue(
      err({ status: 404, code: "NOT_RUNNING", message: "" })
    );
    expect(getDevServerInfo("ws")).toEqual({ running: false, logPath: null });
  });
});

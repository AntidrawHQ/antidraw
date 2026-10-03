import { describe, test, expect, vi, beforeEach } from "vitest";
import { ok, err } from "neverthrow";
import fs from "node:fs";

vi.mock("@/main/services/dev-server.service", () => ({
  getDevServerStatus: vi.fn(),
}));
// Fixed path: the real helper resolves under $HOME.
vi.mock("@/main/api/init", () => ({
  getWorkspaceDevServerLogPath: (id: string) => `/ws/${id}/logs/dev-server.log`,
}));

import { getDevServerStatus } from "@/main/services/dev-server.service";
import { getDevServerInfo } from "@/main/api/tools/dev-server";

const mockStatus = vi.mocked(getDevServerStatus);
const existsSpy = vi.spyOn(fs, "existsSync");
const stored = { workspaceId: "ws", pid: 1, port: 5173, startedAt: 42 };
const notRunning = err({
  status: 404,
  code: "NOT_RUNNING",
  message: "",
} as const);

describe("getDevServerInfo", () => {
  beforeEach(() => {
    mockStatus.mockReset();
    existsSpy.mockReset().mockReturnValue(true);
  });

  test("passes the service state through, adding url and logPath", () => {
    mockStatus.mockReturnValue(ok({ ...stored, running: true }));
    expect(getDevServerInfo("ws")).toMatchInlineSnapshot(`
      {
        "logPath": "/ws/ws/logs/dev-server.log",
        "pid": 1,
        "port": 5173,
        "running": true,
        "startedAt": 42,
        "url": "https://localhost:5173",
        "workspaceId": "ws",
      }
    `);
    expect(mockStatus).toHaveBeenCalledWith("ws");
  });

  test("stale entry (pid dead) keeps its port/url so the disparity is visible", () => {
    mockStatus.mockReturnValue(ok({ ...stored, running: false }));
    expect(getDevServerInfo("ws")).toMatchInlineSnapshot(`
      {
        "logPath": "/ws/ws/logs/dev-server.log",
        "pid": 1,
        "port": 5173,
        "running": false,
        "startedAt": 42,
        "url": "https://localhost:5173",
        "workspaceId": "ws",
      }
    `);
  });

  test("no stored server: running false, log path still reported", () => {
    mockStatus.mockReturnValue(notRunning);
    expect(getDevServerInfo("ws")).toMatchInlineSnapshot(`
      {
        "logPath": "/ws/ws/logs/dev-server.log",
        "running": false,
      }
    `);
  });

  test("logPath is null when the server has never been started", () => {
    existsSpy.mockReturnValue(false);
    mockStatus.mockReturnValue(notRunning);
    expect(getDevServerInfo("ws")).toMatchInlineSnapshot(`
      {
        "logPath": null,
        "running": false,
      }
    `);
  });
});

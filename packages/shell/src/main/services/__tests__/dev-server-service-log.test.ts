import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Real child processes and a real log file; only the Electron-bound edges
// (paths under $HOME, electron-store, npm, the component watcher) are mocked.
const h = vi.hoisted(() => ({ root: "", script: "" }));

vi.mock("@/main/api/init", () => ({
  getWorkspaceSourcePath: () => h.root,
  getWorkspaceDevServerLogPath: () => `${h.root}/logs/dev-server.log`,
}));
vi.mock("@/main/lib/runtime-store", () => {
  const servers = new Map<string, unknown>();
  return {
    devServerStore: {
      get: (id: string) => servers.get(id),
      set: (s: { workspaceId: string }) => servers.set(s.workspaceId, s),
      remove: (id: string) => servers.delete(id),
      getAll: () => [...servers.values()],
      clear: () => servers.clear(),
    },
  };
});
vi.mock("@/main/api/services/component.service", () => ({
  startComponentWatcher: async () => {},
  stopComponentWatcher: async () => {},
}));
vi.mock("@/main/lib/package-manager", () => ({
  spawnNpm: (_args: string[], cwd: string, options: SpawnOptions) =>
    spawn(process.execPath, ["-e", h.script], { ...options, cwd, env: process.env }),
}));

import {
  startDevServer,
  stopDevServer,
  stopAllDevServers,
} from "@/main/services/dev-server.service";

const VITE = `console.log("VITE ready in 1 ms"); setInterval(() => {}, 1000);`;

const logPath = () => path.join(h.root, "logs", "dev-server.log");
const readLog = () =>
  fs
    .readFileSync(logPath(), "utf8")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>")
    .replace(/pid=\d+ port=\d+/g, "pid=<pid> port=<port>");

describe("dev server run log", () => {
  beforeEach(() => {
    h.root = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-svc-"));
    h.script = VITE;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    stopAllDevServers();
    vi.restoreAllMocks();
    fs.rmSync(h.root, { recursive: true, force: true });
  });

  test("brackets a run's raw output with start and exit markers", async () => {
    expect((await startDevServer("ws")).isOk()).toBe(true);
    stopDevServer("ws");

    await vi.waitFor(() => expect(readLog()).toContain("exited"));
    expect(readLog()).toMatchInlineSnapshot(`
      "=== dev server started pid=<pid> port=<port> <ts> ===
      VITE ready in 1 ms
      === dev server exited code=null <ts> ===
      "
    `);
  });

  test("a log that fails to open doesn't stall the ready check", async () => {
    // The open fails asynchronously, after the stream has been handed out.
    fs.mkdirSync(path.dirname(logPath()));
    fs.writeFileSync(logPath(), "");
    fs.chmodSync(logPath(), 0o000);

    expect((await startDevServer("ws")).isOk()).toBe(true);
  });

  test("a logs dir that can't be created doesn't fail the start", async () => {
    fs.writeFileSync(path.join(h.root, "logs"), "");

    expect((await startDevServer("ws")).isOk()).toBe(true);
  });

  test("app quit writes a stop marker synchronously", async () => {
    await startDevServer("ws");
    await vi.waitFor(() => expect(readLog()).toContain("VITE ready"));

    stopAllDevServers();

    expect(readLog()).toMatchInlineSnapshot(`
      "=== dev server started pid=<pid> port=<port> <ts> ===
      VITE ready in 1 ms
      === dev server stopped (app quit) <ts> ===
      "
    `);
  });

  test("a restart supersedes the previous run's still-open log", async () => {
    // Lingers after SIGTERM and keeps printing, so its `close` lands well
    // after the next run has started.
    h.script = `
      console.log("VITE ready in 1 ms");
      process.on("SIGTERM", () => {
        console.log("run 1 shutting down");
        setTimeout(() => process.exit(0), 300);
      });
      setInterval(() => {}, 1000);`;
    await startDevServer("ws");
    await vi.waitFor(() => expect(readLog()).toContain("VITE ready"));
    stopDevServer("ws");

    h.script = VITE;
    await startDevServer("ws");
    await vi.waitFor(() => expect(readLog().match(/VITE ready/g)).toHaveLength(2));
    // Let run 1 exit; nothing of it may land inside run 2's section.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(readLog()).toMatchInlineSnapshot(`
      "=== dev server started pid=<pid> port=<port> <ts> ===
      VITE ready in 1 ms
      === dev server log superseded by a new run <ts> ===
      === dev server started pid=<pid> port=<port> <ts> ===
      VITE ready in 1 ms
      "
    `);
  });
});

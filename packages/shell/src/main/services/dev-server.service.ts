import { exec, type ChildProcess, execSync } from "child_process";
import { access } from "fs/promises";
import getPort from "get-port";
import { ok, err, type Result } from "neverthrow";
import {
  getWorkspaceDevServerLogPath,
  getWorkspaceSourcePath,
} from "@/main/api/init";
import {
  logMarker,
  openDevServerLog,
  type DevServerLog,
} from "@/main/services/dev-server-log";
import { devServerStore, type DevServerState } from "@/main/lib/runtime-store";
import { spawnNpm } from "@/main/lib/package-manager";
import {
  startComponentWatcher,
  stopComponentWatcher,
} from "@/main/api/services/component.service";

// In-memory map for ChildProcess handles (can't be serialized to electron-store)
const runningProcesses = new Map<string, ChildProcess>();

// Open run logs, keyed like runningProcesses
const runningLogs = new Map<string, DevServerLog>();

// Status response includes runtime check
export type DevServerInfo = DevServerState & {
  running: boolean;
};

// Error codes for dev server operations
export const DevServerErrorCode = {
  WORKSPACE_NOT_FOUND: "WORKSPACE_NOT_FOUND",
  SPAWN_FAILED: "SPAWN_FAILED",
  STARTUP_TIMEOUT: "STARTUP_TIMEOUT",
  NOT_RUNNING: "NOT_RUNNING",
} as const;

type DevServerErrorCode =
  (typeof DevServerErrorCode)[keyof typeof DevServerErrorCode];

type DevServerError = {
  status: 500 | 404 | 409;
  code: DevServerErrorCode;
  message: string;
};

const spawnFailed = (cause: unknown) =>
  err({
    status: 500,
    code: DevServerErrorCode.SPAWN_FAILED,
    message: `Failed to start dev server: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
  } satisfies DevServerError);

const killProcessTree = (pid: number): void => {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    // Process may already be dead
  }
};

const killProcessTreeAsync = (pid: number): Promise<void> => {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec(`taskkill /pid ${pid} /T /F`, () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Process may already be dead
      }
      resolve();
    }
  });
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const startDevServer = async (
  workspaceId: string
): Promise<Result<DevServerState, DevServerError>> => {
  // Check if already running
  const existing = runningProcesses.get(workspaceId);

  if (existing && !existing.killed && existing.pid && isProcessRunning(existing.pid)) {
    const stored = devServerStore.get(workspaceId);

    if (stored) {
      return ok(stored);
    }
  }

  const workspacePath = getWorkspaceSourcePath(workspaceId);

  try {
    await access(workspacePath);
  } catch {
    return err({
      status: 404,
      code: DevServerErrorCode.WORKSPACE_NOT_FOUND,
      message: `Workspace source path not found: ${workspacePath}`,
    } satisfies DevServerError);
  }

  let port: number;
  let proc: ChildProcess;

  try {
    port = await getPort();
    proc = spawnNpm(
      ["run", "dev", "--", "--port", port.toString()],
      workspacePath,
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        // Output goes to a log file, not a terminal; keep colour codes out of
        // it even if the user's shell exports FORCE_COLOR.
        env: { NO_COLOR: "1" },
      },
    );
  } catch (error) {
    return spawnFailed(error);
  }

  // A spawn that fails asynchronously (missing or non-executable binary)
  // reports through an `error` event, which is an uncaught exception in the
  // main process if nothing listens.
  const spawnError = new Promise<Error>((resolve) => {
    proc.on("error", (error) => {
      console.error(`Dev server process error for ${workspaceId}:`, error);
      resolve(error);
    });
  });

  if (!proc.pid) {
    const noPid = new Promise<string>((resolve) =>
      setTimeout(() => resolve("no PID assigned"), 1000),
    );
    return spawnFailed(await Promise.race([spawnError, noPid]));
  }

  const state = {
    workspaceId,
    pid: proc.pid,
    port,
    startedAt: Date.now(),
  } satisfies DevServerState;

  // Store process handle in memory
  runningProcesses.set(workspaceId, proc);

  // Persist for crash recovery
  devServerStore.set(state);

  // Append-only run log; the agent reads it via the path from
  // get_dev_server_info. Raw output, bracketed by start/exit markers.
  // A previous run whose `close` hasn't fired yet still holds the file;
  // end it first so a rotation can't carry its output off into `.1`.
  void runningLogs
    .get(workspaceId)
    ?.end(logMarker("dev server log superseded by a new run"));
  const log = openDevServerLog(getWorkspaceDevServerLogPath(workspaceId));
  runningLogs.set(workspaceId, log);
  log.write(logMarker(`dev server started pid=${proc.pid} port=${port}`));
  // Written from `data` listeners rather than pipe(): a pipe pauses its
  // source when the destination errors, which would stall the ready check
  // below and leave the child's output undrained.
  proc.stdout!.on("data", (data: Buffer) => log.write(data));
  proc.stderr!.on("data", (data: Buffer) => log.write(data));

  // Wait for Vite to signal it's ready via stdout
  const readyPromise = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 30000);

    const onData = (data: Buffer) => {
      const output = data.toString();
      console.log(`[${workspaceId}] ${output.trim()}`);

      // Vite outputs "ready in X ms" or "Local: https://localhost:PORT"
      if (output.includes("ready in") || output.includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        proc.stdout!.off("data", onData);
        resolve(true);
      }
    };

    proc.stdout!.on("data", onData);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(false);
      }
    });
  });

  // Cleanup on exit (after ready check)
  // `close` (not `exit`): it fires once stdout/stderr have drained, so the
  // exit marker lands after the last output line and nothing is written to
  // an already-ended log stream.
  proc.on("close", (code) => {
    void log.end(logMarker(`dev server exited code=${code}`));
    if (runningLogs.get(workspaceId) === log) {
      runningLogs.delete(workspaceId);
    }
  });

  proc.on("exit", (code) => {
    console.log(`Dev server for ${workspaceId} exited with code ${code}`);
    runningProcesses.delete(workspaceId);
    devServerStore.remove(workspaceId);
    stopComponentWatcher(workspaceId).catch((error) => {
      console.error(`Failed to stop component watcher for ${workspaceId}:`, error);
    });
  });

  proc.stderr!.on("data", (data) => {
    console.error(`[${workspaceId}] ${data.toString().trim()}`);
  });

  const ready = await readyPromise;

  if (!ready) {
    killProcessTree(proc.pid);
    runningProcesses.delete(workspaceId);
    devServerStore.remove(workspaceId);

    return err({
      status: 500,
      code: DevServerErrorCode.STARTUP_TIMEOUT,
      message: "Dev server failed to start within timeout",
    } satisfies DevServerError);
  }

  startComponentWatcher(workspaceId).catch((error) => {
    console.error(`Failed to start component watcher for ${workspaceId}:`, error);
  });

  return ok(state);
};

export const stopDevServer = (
  workspaceId: string
): Result<{ stopped: boolean }, DevServerError> => {
  const proc = runningProcesses.get(workspaceId);
  const stored = devServerStore.get(workspaceId);

  if (!proc && !stored) {
    return err({
      status: 404,
      code: DevServerErrorCode.NOT_RUNNING,
      message: "No dev server running for this workspace",
    } satisfies DevServerError);
  }

  if (proc?.pid) {
    killProcessTree(proc.pid);
    runningProcesses.delete(workspaceId);
  } else if (stored) {
    killProcessTree(stored.pid);
  }

  devServerStore.remove(workspaceId);

  stopComponentWatcher(workspaceId).catch((error) => {
    console.error(`Failed to stop component watcher for ${workspaceId}:`, error);
  });

  return ok({ stopped: true });
};

export const getDevServerStatus = (
  workspaceId: string
): Result<DevServerInfo, DevServerError> => {
  const stored = devServerStore.get(workspaceId);

  if (!stored) {
    return err({
      status: 404,
      code: DevServerErrorCode.NOT_RUNNING,
      message: "No dev server running for this workspace",
    } satisfies DevServerError);
  }

  const running = isProcessRunning(stored.pid);

  return ok({
    ...stored,
    running,
  } satisfies DevServerInfo);
};

export const stopAllDevServers = (): void => {
  for (const [workspaceId, proc] of runningProcesses) {
    if (proc.pid) {
      killProcessTree(proc.pid);
    }
    runningProcesses.delete(workspaceId);
    stopComponentWatcher(workspaceId).catch((error) => {
      console.error(`Failed to stop component watcher for ${workspaceId}:`, error);
    });
  }

  // This runs on app quit: the process is gone before the children's
  // `close` events fire, so their exit markers would never be written.
  for (const log of runningLogs.values()) {
    log.endSync(logMarker("dev server stopped (app quit)"));
  }
  runningLogs.clear();

  devServerStore.clear();
};

export const cleanupOrphanedProcesses = async (): Promise<void> => {
  const storedServers = devServerStore.getAll();

  for (const server of storedServers) {
    if (isProcessRunning(server.pid)) {
      console.log(
        `Killing orphaned dev server: ${server.workspaceId} (PID: ${server.pid})`
      );
      await killProcessTreeAsync(server.pid);
    }
    devServerStore.remove(server.workspaceId);
  }
};

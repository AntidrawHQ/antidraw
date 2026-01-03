import { spawn, type ChildProcess, execSync } from "child_process";
import getPort from "get-port";
import { ok, err, type Result } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { devServerStore, type DevServerState } from "@/main/lib/runtime-store";

// In-memory map for ChildProcess handles (can't be serialized to electron-store)
const runningProcesses = new Map<string, ChildProcess>();

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
  ALREADY_RUNNING: "ALREADY_RUNNING",
} as const;

type DevServerErrorCode =
  (typeof DevServerErrorCode)[keyof typeof DevServerErrorCode];

type DevServerError = {
  status: 500 | 404 | 409;
  code: DevServerErrorCode;
  message: string;
};

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

  if (existing && !existing.killed) {
    const stored = devServerStore.get(workspaceId);

    if (stored) {
      return ok(stored);
    }
  }

  const workspacePath = getWorkspaceSourcePath(workspaceId);
  const port = await getPort();

  const proc = spawn("npm", ["run", "dev", "--", "--port", port.toString()], {
    cwd: workspacePath,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!proc.pid) {
    return err({
      status: 500,
      code: DevServerErrorCode.SPAWN_FAILED,
      message: "Failed to start dev server: no PID assigned",
    } satisfies DevServerError);
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

  // Wait for Vite to signal it's ready via stdout
  const readyPromise = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 30000);

    const onData = (data: Buffer) => {
      const output = data.toString();
      console.log(`[${workspaceId}] ${output.trim()}`);

      // Vite outputs "ready in X ms" or "Local: http://localhost:PORT"
      if (output.includes("ready in") || output.includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        proc.stdout.off("data", onData);
        resolve(true);
      }
    };

    proc.stdout.on("data", onData);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(false);
      }
    });
  });

  // Cleanup on exit (after ready check)
  proc.on("exit", (code) => {
    console.log(`Dev server for ${workspaceId} exited with code ${code}`);
    runningProcesses.delete(workspaceId);
    devServerStore.remove(workspaceId);
  });

  proc.stderr.on("data", (data) => {
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

  const proc = runningProcesses.get(workspaceId);
  const running = proc ? !proc.killed : isProcessRunning(stored.pid);

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
  }

  devServerStore.clear();
};

export const cleanupOrphanedProcesses = (): void => {
  const storedServers = devServerStore.getAll();

  for (const server of storedServers) {
    if (isProcessRunning(server.pid)) {
      console.log(
        `Killing orphaned dev server: ${server.workspaceId} (PID: ${server.pid})`
      );
      killProcessTree(server.pid);
    }
    devServerStore.remove(server.workspaceId);
  }
};

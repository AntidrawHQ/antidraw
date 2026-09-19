import fs from "node:fs";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getWorkspaceDevServerLogPath } from "@/main/api/init";
import { getDevServerStatus } from "@/main/services/dev-server.service";

export type DevServerToolInfo =
  | {
      status: "running";
      url: string;
      port: number;
      startedAt: number;
      logPath: string | null;
    }
  | { status: "stopped"; url: null; logPath: string | null };

// The log persists across runs, so it is reported for a stopped server too:
// its tail is how the agent finds out why the server went away.
const existingLogPath = (workspaceId: string): string | null => {
  const p = getWorkspaceDevServerLogPath(workspaceId);
  return fs.existsSync(p) ? p : null;
};

// A stale entry in the runtime store (the pid died without a clean stop)
// reports as stopped rather than leaking a port nothing listens on.
export const getDevServerInfo = (workspaceId: string): DevServerToolInfo => {
  const result = getDevServerStatus(workspaceId);
  const logPath = existingLogPath(workspaceId);
  if (result.isErr() || !result.value.running) {
    return { status: "stopped", url: null, logPath };
  }
  const { port, startedAt } = result.value;
  // https: the runtime's Vite plugin serves with a self-signed localhost cert.
  return {
    status: "running",
    url: `https://localhost:${port}`,
    port,
    startedAt,
    logPath,
  };
};

export const devServerTool = (workspaceId: string) =>
  tool(
    "get_dev_server",
    "Get the status, URL and log file of the Vite dev server for the current " +
      "workspace. Returns status 'running' with url (https, self-signed cert: " +
      "use curl -k), port and startedAt, or " +
      "status 'stopped' with url null. logPath is the server's append-only " +
      "log (stdout/stderr, one timestamped line each, with start/exit markers " +
      "per run); read or tail it to see build errors and HMR output. It is " +
      "null if the server has never been started.",
    {},
    async () => ({
      content: [
        { type: "text", text: JSON.stringify(getDevServerInfo(workspaceId)) },
      ],
    }),
    { annotations: { readOnlyHint: true } }
  );

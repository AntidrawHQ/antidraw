import fs from "node:fs";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getWorkspaceDevServerLogPath } from "@/main/api/init";
import {
  getDevServerStatus,
  type DevServerInfo,
} from "@/main/services/dev-server.service";

// The service's ground state, plus two derived fields. No reinterpretation:
// a stale entry (pid dead) comes through as running:false with its old
// port/url still attached, and the agent can reason about the disparity.
export type DevServerToolInfo =
  | (DevServerInfo & { url: string; logPath: string | null })
  | { running: false; logPath: string | null };

export const getDevServerInfo = (workspaceId: string): DevServerToolInfo => {
  const result = getDevServerStatus(workspaceId);
  const p = getWorkspaceDevServerLogPath(workspaceId);
  const logPath = fs.existsSync(p) ? p : null;
  if (result.isErr()) return { running: false, logPath };
  // https: the runtime's Vite plugin serves with a self-signed localhost cert.
  return {
    ...result.value,
    url: `https://localhost:${result.value.port}`,
    logPath,
  };
};

export const devServerInfoTool = (workspaceId: string) =>
  tool(
    "get_dev_server_info",
    "Get the state of the Vite dev server for the current workspace. " +
      "`running` is a live check of the server process; running:false " +
      "alongside a pid means the process died. The url's cert is " +
      "self-signed (curl -k). logPath is the server's raw stdout/stderr, " +
      "append-only across runs with a start/exit marker line per run; null " +
      "if the server has never been started.",
    {},
    async () => ({
      content: [
        { type: "text", text: JSON.stringify(getDevServerInfo(workspaceId)) },
      ],
    }),
    { annotations: { readOnlyHint: true } }
  );

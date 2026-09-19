import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getDevServerStatus } from "@/main/services/dev-server.service";

export type DevServerToolInfo =
  | { status: "running"; url: string; port: number; startedAt: number }
  | { status: "stopped"; url: null };

// A stale entry in the runtime store (the pid died without a clean stop)
// reports as stopped rather than leaking a port nothing listens on.
export const getDevServerInfo = (workspaceId: string): DevServerToolInfo => {
  const result = getDevServerStatus(workspaceId);
  if (result.isErr() || !result.value.running) {
    return { status: "stopped", url: null };
  }
  const { port, startedAt } = result.value;
  return { status: "running", url: `http://localhost:${port}`, port, startedAt };
};

export const devServerTool = (workspaceId: string) =>
  tool(
    "get_dev_server",
    "Get the status and URL of the Vite dev server for the current workspace. " +
      "Returns status 'running' with the url, port and startedAt timestamp, or " +
      "status 'stopped' with url null when no dev server is running.",
    {},
    async () => ({
      content: [
        { type: "text", text: JSON.stringify(getDevServerInfo(workspaceId)) },
      ],
    }),
    { annotations: { readOnlyHint: true } }
  );

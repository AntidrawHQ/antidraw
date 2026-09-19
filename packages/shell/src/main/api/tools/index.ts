import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { devServerInfoTool } from "@/main/api/tools/dev-server";

export const DEV_SERVER_MCP_SERVER_NAME = "workspace_dev_server";

// In-process MCP server exposing the workspace's dev server to the agent.
// Built per query so each tool closes over the workspace the turn runs in.
// Tools surface to the model as `mcp__workspace_dev_server__<tool>`.
export const createDevServerMcpServer = (workspaceId: string) =>
  createSdkMcpServer({
    name: DEV_SERVER_MCP_SERVER_NAME,
    version: "1.0.0",
    // The tool set is tiny; keep it in the prompt instead of behind tool
    // search so the agent doesn't need a lookup round-trip to find it.
    alwaysLoad: true,
    tools: [devServerInfoTool(workspaceId)],
  });

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { devServerTool } from "@/main/api/tools/dev-server";

export const ANTIDRAW_MCP_SERVER_NAME = "antidraw";

// In-process MCP server exposing shell state to the agent. Built per query so
// each tool closes over the workspace the turn runs in. Tools surface to the
// model as `mcp__antidraw__<tool>`.
export const createAntidrawMcpServer = (workspaceId: string) =>
  createSdkMcpServer({
    name: ANTIDRAW_MCP_SERVER_NAME,
    version: "1.0.0",
    // The tool set is tiny; keep it in the prompt instead of behind tool
    // search so the agent doesn't need a lookup round-trip to find it.
    alwaysLoad: true,
    tools: [devServerTool(workspaceId)],
  });

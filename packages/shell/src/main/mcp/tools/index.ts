import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDeps } from "../types";
import { registerCommentTools } from "./comments";
import { registerEditTools } from "./edits";
import { registerOrientationTools } from "./orientation";
import { registerViewTools } from "./view";

// Where a tool registers: the server, or the server with each call counted.
export type ToolRegistry = Pick<McpServer, "registerTool">;

// A call as analytics has it: which of the tools, whether it did what was
// asked, and how long it took. Never its arguments or its result: those are
// the user's comments, code and canvas.
export type ToolCall = { tool: string; ok: boolean; durationMs: number };

// Counted as the tool's own callback runs: a call the SDK turns away first
// (an unknown tool, arguments that don't parse) isn't one, so `tool` is
// always a name registered here, never a string an agent made up.
export const countingCalls = (server: McpServer, onCall: (call: ToolCall) => void): ToolRegistry => ({
  registerTool: (name, config, cb) => {
    const run = cb as (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;
    const counted = async (...args: unknown[]) => {
      const started = performance.now();
      let ok = false;
      try {
        const result = await run(...args);
        ok = result.isError !== true;
        return result;
      } finally {
        onCall({ tool: name, ok, durationMs: Math.round(performance.now() - started) });
      }
    };
    return server.registerTool(name, config, counted as typeof cb);
  },
});

export const registerTools = (server: ToolRegistry, deps: ToolDeps) => {
  registerOrientationTools(server, deps);
  registerCommentTools(server, deps);
  registerEditTools(server, deps);
  registerViewTools(server, deps);
};

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../types";
import { registerCommentTools } from "./comments";
import { registerEditTools } from "./edits";
import { registerOrientationTools } from "./orientation";
import { registerViewTools } from "./view";

export const registerTools = (server: McpServer, deps: ToolDeps) => {
  registerOrientationTools(server, deps);
  registerCommentTools(server, deps);
  registerEditTools(server, deps);
  registerViewTools(server, deps);
};

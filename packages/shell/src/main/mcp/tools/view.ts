import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../types";
import { fail, json, resolveOpenWorkspace, workspaceIdArg } from "./shared";

// Moving the user's view: the workspace the app shows, and the frame its
// canvas is on. The user's view, so only with a reason.

export const registerViewTools = (server: McpServer, deps: ToolDeps) => {
  const { host, canvas } = deps;

  server.registerTool(
    "open_workspace",
    {
      description:
        "Switch Antidraw's window to another workspace, which starts its dev server (get_dev_server_info says when it's " +
        "running). It replaces what the user is looking at: only when they asked, or the work is in that workspace.",
      inputSchema: { workspaceId: z.string().describe("The workspace's id, from list_workspaces") },
    },
    async ({ workspaceId }) => {
      const ws = await host.getWorkspace(workspaceId);
      if (ws.isErr()) return fail(ws.error.message);
      const opened = await canvas.openWorkspace(workspaceId);
      if (opened.isErr()) return fail(opened.error.message);
      return json({ id: ws.value.id, name: ws.value.name, sourcePath: host.sourcePath(workspaceId) });
    },
  );

  server.registerTool(
    "focus_component",
    {
      description:
        "Scroll Antidraw's canvas to a component's frame, to show the user something there. Only in the workspace open in " +
        "Antidraw.",
      inputSchema: {
        name: z.string().describe("The component's name, as get_active_workspace lists it"),
        workspaceId: workspaceIdArg,
      },
    },
    async ({ name, workspaceId }) => {
      const ws = await resolveOpenWorkspace(deps, workspaceId);
      if (ws.isErr()) return fail(ws.error);
      const names = await host.listComponents(ws.value.id);
      if (names.isErr()) return fail(names.error.message);
      if (!names.value.includes(name)) return fail(`No component ${name} in this workspace`);
      const focused = await canvas.focusComponent(name);
      return focused.isErr() ? fail(focused.error.message) : json({ focused: name });
    },
  );
};

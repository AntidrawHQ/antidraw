import { ok } from "neverthrow";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { componentFile } from "@/shared/utils/canvas-comments";
import type { MirroredPick } from "@/shared/canvas-mirror";
import type { ToolDeps } from "../types";
import {
  COMPONENTS_FOLDER,
  elementFields,
  fail,
  json,
  previewUrl,
  reply,
  resolveOpenWorkspace,
  resolveWorkspace,
  workspaceIdArg,
} from "./shared";

// Where the agent is: the workspace and its frames, what the user has
// picked on the canvas, and the dev server that renders it.

// A picked element as the built-in chat's <canvas-selection> has it
// (renderer/inspector/tags.ts), as data: its frame's component and file,
// where it's written, and what its frame said about it when tagged.
const pickOf = ({ frame, info, seen }: MirroredPick) => {
  const { loc, index, callsite, tag, id, classes, text } = elementFields(info);
  return {
    component: frame,
    file: componentFile(frame),
    loc,
    callsite,
    tag,
    id,
    classes,
    text,
    index,
    // A context as a frame's agent gives one now (its markup); an older
    // shape is none, as the chat's usableContext takes it.
    seen: seen && typeof seen.html === "string" ? seen : null,
  };
};

export const registerOrientationTools = (server: McpServer, deps: ToolDeps) => {
  const { host, canvas } = deps;

  server.registerTool(
    "get_active_workspace",
    {
      description:
        "The workspace open in Antidraw: its id and name; sourcePath, the project's directory on this machine (work there, " +
        "with your own file tools); componentsFolder, relative to it, where each frame's component is; the components, each " +
        "with its file and previewUrl (null while the dev server isn't running); and the dev server's state. Call it first.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const id = canvas.view().activeWorkspaceId;
      if (!id) return json({ workspace: null, message: "No workspace is open in Antidraw." });
      const ws = await resolveWorkspace(deps, id);
      if (ws.isErr()) return fail(ws.error);
      const names = await host.listComponents(id);
      if (names.isErr()) return fail(names.error.message);
      const dev = host.devServer(id);
      return json({
        id,
        name: ws.value.name,
        sourcePath: host.sourcePath(id),
        componentsFolder: COMPONENTS_FOLDER,
        components: names.value.map((name) => ({ name, file: componentFile(name), previewUrl: previewUrl(dev, name) })),
        devServer: { running: dev.running, url: dev.running && "url" in dev ? dev.url : null, logPath: dev.logPath },
      });
    },
  );

  server.registerTool(
    "get_selection",
    {
      description:
        "The element selected on Antidraw's canvas with its inspector, and the elements tagged for the next message: each " +
        "with its frame's component and file, loc (file:line:col where it's written), callsite (where it's used in the " +
        "frame's component, for one a shared component renders), tag, id, classes, text, index (which of the elements " +
        "rendered from loc, as a .map() repeats one), and seen: what its frame said about it when tagged, its markup " +
        "included (null if none). Only the workspace open in Antidraw has one.",
      inputSchema: { workspaceId: workspaceIdArg },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) =>
      reply(
        (await resolveOpenWorkspace(deps, workspaceId)).map((ws) => {
          const { selection, tags } = canvas.view();
          return { workspaceId: ws.id, selection: selection && pickOf(selection), tags: tags.map(pickOf) };
        }),
      ),
  );

  server.registerTool(
    "list_workspaces",
    {
      description: "Every workspace in Antidraw: id, name, and sourcePath, its project's directory on this machine.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      reply(
        (await host.listWorkspaces())
          .mapErr((e) => e.message)
          .map((all) => ({ workspaces: all.map((ws) => ({ ...ws, sourcePath: host.sourcePath(ws.id) })) })),
      ),
  );

  server.registerTool(
    "get_dev_server_info",
    {
      description:
        "The workspace's Vite dev server, which renders its frames. `running` is a live check that its pid is alive; a " +
        "stale entry keeps its old port and url. A frame's component previews at <url>/preview?componentName=<Name>. The " +
        "certificate is self-signed: curl -k, and browser tools must ignore certificate errors. logPath is the server's raw " +
        "stdout/stderr, append-only across runs with a start/exit marker line per run; null if it never started.",
      inputSchema: { workspaceId: workspaceIdArg },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) =>
      reply((await resolveWorkspace(deps, workspaceId)).andThen((ws) => ok(host.devServer(ws.id)))),
  );
};

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { changesOf, previewCss } from "@/shared/design";
import { componentFile } from "@/shared/utils/canvas-comments";
import { editRev } from "@/shared/utils/canvas-edits";
import type { ToolDeps } from "../types";
import { elementFields, fail, json, resolveWorkspace, workspaceIdArg } from "./shared";

// The Design panel's edits: style changes the frames preview over the code
// until something writes them into it. As the built-in chat's
// <canvas-edits> (shared/utils/canvas-edits.ts) says them, as data.

export const registerEditTools = (server: McpServer, deps: ToolDeps) => {
  const { canvas } = deps;

  server.registerTool(
    "get_design_edits",
    {
      description:
        "The Design panel's pending edits: style changes the user made to elements, previewed on the frames but not in " +
        "the code yet. Each with its id and rev (its state as you read it), the frame's component and file, the element (loc file:line:col, index, tag, " +
        "text), its changes as the panel words them (\"Corner radius: 16 → 24\", in CSS px; Fill is the background, Auto " +
        "layout flex), previewCss (the declarations that previewed them: write the code to match), " +
        "and seen: the element as its frame described it when first edited, markup included (null if none). Once " +
        "written, mark_design_edits_applied with each one's id and rev.",
      inputSchema: { workspaceId: workspaceIdArg },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      const ws = await resolveWorkspace(deps, workspaceId);
      if (ws.isErr()) return fail(ws.error);
      return json({
        workspaceId: ws.value.id,
        edits: canvas.pendingEdits(ws.value.id).map((e) => {
          const { loc, index, tag, text } = elementFields(e.element);
          return {
            id: e.id,
            rev: editRev(e),
            component: e.componentName,
            file: componentFile(e.componentName),
            element: e.name,
            loc,
            index,
            tag,
            text,
            changes: changesOf(e.base, e.now).map((c) => `${c.group.label}: ${c.from} → ${c.to}`),
            previewCss: previewCss(e.base, e.now),
            seen: e.seen,
          };
        }),
      });
    },
  );

  server.registerTool(
    "mark_design_edits_applied",
    {
      description:
        "Once the code has these edits from get_design_edits: takes them off the pending list, so their preview drops and " +
        "the frames show your code. All or none: if any isn't pending any more (the user undid it, or it was applied), or " +
        "the user changed it after you read it (its rev differs), nothing is marked: get_design_edits again, write what " +
        "changed, and mark with the new revs.",
      inputSchema: {
        edits: z
          .array(z.object({ id: z.number().int(), rev: z.string() }))
          .min(1)
          .describe("The edits you wrote, each with its id and rev as get_design_edits gave them"),
        workspaceId: workspaceIdArg,
      },
    },
    async ({ edits, workspaceId }) => {
      const ws = await resolveWorkspace(deps, workspaceId);
      if (ws.isErr()) return fail(ws.error);
      const marked = canvas.markEditsApplied(ws.value.id, edits);
      return marked.isErr() ? fail(marked.error.message) : json({ applied: marked.value });
    },
  );
};

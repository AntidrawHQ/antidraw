import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { componentFile } from "@/shared/utils/canvas-comments";
import type { ToolDeps } from "../types";
import { elementFields, fail, json, resolveWorkspace, workspaceIdArg } from "./shared";

// The comments the user pins on frames for an agent outside the app: those
// not sent to one of its chats (a sent one is that chat's). Read, then
// closed one by one with a note the user sees in the list.

const commentId = z.number().int().describe("The comment's id, from get_comments");

export const registerCommentTools = (server: McpServer, deps: ToolDeps) => {
  const { canvas } = deps;

  server.registerTool(
    "get_comments",
    {
      description:
        "The open comments the user pinned on the workspace's frames: each with its id, the frame's component and file, " +
        "the text, the pin's x/y in the frame's CSS pixels, and the element under the pin as the inspector saw it: loc " +
        "(file:line:col), index (which of the elements rendered there), tag, elementText and callsite (null where the " +
        "frame couldn't say). Reading claims nothing: close each with complete_comment or dismiss_comment.",
      inputSchema: { workspaceId: workspaceIdArg },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      const ws = await resolveWorkspace(deps, workspaceId);
      if (ws.isErr()) return fail(ws.error);
      const comments = await canvas.openComments(ws.value.id);
      if (comments.isErr()) return fail(comments.error.message);
      return json({
        workspaceId: ws.value.id,
        comments: comments.value.map((c) => {
          const { loc, index, tag, text, callsite } = elementFields(c.element);
          return {
            id: c.id,
            component: c.componentName,
            file: componentFile(c.componentName),
            text: c.text,
            pin: { x: Math.round(c.x), y: Math.round(c.y) },
            loc,
            index,
            tag,
            elementText: text,
            callsite,
          };
        }),
      });
    },
  );

  server.registerTool(
    "complete_comment",
    {
      description:
        "Mark a comment from get_comments done, once you've done what it asks. `note` is one short line on what you " +
        'changed (e.g. "Gap 24 → 12px"); the user sees it in the comment list. Marking one again replaces its note.',
      inputSchema: {
        id: commentId,
        note: z.string().trim().min(1).describe("One line on what changed"),
        workspaceId: workspaceIdArg,
      },
    },
    async ({ id, note, workspaceId }) => {
      const ws = await resolveWorkspace(deps, workspaceId);
      if (ws.isErr()) return fail(ws.error);
      const done = await canvas.completeComment(ws.value.id, id, note);
      return done.isErr() ? fail(done.error.message) : json({ id, state: "done" });
    },
  );

  server.registerTool(
    "dismiss_comment",
    {
      description:
        "Close a comment from get_comments without doing it: it doesn't apply, is already so, or you won't. `reason` is " +
        "one short line the user sees in the comment list. Ask the user instead where it's only unclear.",
      inputSchema: {
        id: commentId,
        reason: z.string().trim().min(1).describe("One line on why"),
        workspaceId: workspaceIdArg,
      },
    },
    async ({ id, reason, workspaceId }) => {
      const ws = await resolveWorkspace(deps, workspaceId);
      if (ws.isErr()) return fail(ws.error);
      const dismissed = await canvas.dismissComment(ws.value.id, id, reason);
      return dismissed.isErr() ? fail(dismissed.error.message) : json({ id, state: "dismissed" });
    },
  );
};

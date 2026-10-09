import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { completeComment } from "@/main/api/services/comment.service";

export const COMMENTS_MCP_SERVER_NAME = "canvas_comments";

// How Claude reports on the comments a <canvas-comments> message handed it.
// Closes over the conversation: a chat marks only its own set's comments.
export const completeCommentTool = (conversationId: string) =>
  tool(
    "complete_comment",
    "Mark one of the comments from this chat's <canvas-comments> message " +
      "completed, once you've done what it asks. `note` is one short line on " +
      "what you changed (e.g. \"Gap 24 → 12px\"); the user sees it, and later " +
      "chats are handed it as history. Don't mark a comment you asked the " +
      "user about instead of acting on. Marking one again replaces its note.",
    {
      id: z.number().int().describe("The comment's id, from <comment id>"),
      note: z.string().min(1).describe("One line on what changed"),
    },
    async ({ id, note }) => {
      const result = await completeComment(conversationId, id, note);
      if (result.isErr())
        return {
          content: [{ type: "text", text: result.error.message }],
          isError: true,
        };
      return { content: [{ type: "text", text: `Comment ${id} marked completed.` }] };
    },
  );

// Tools surface to the model as `mcp__canvas_comments__<tool>`.
export const createCommentsMcpServer = (conversationId: string) =>
  createSdkMcpServer({
    name: COMMENTS_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [completeCommentTool(conversationId)],
  });

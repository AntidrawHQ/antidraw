import { query } from "@anthropic-ai/claude-agent-sdk";
import { ok, err } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";

export const sendMessage = (params: {
  message: string;
  workspaceId: string;
  claudeCodeSessionID?: string;
}) => {
  try {
    const { message, workspaceId, claudeCodeSessionID } = params;
    const workspacePath = getWorkspaceSourcePath(workspaceId);

    const res = query({
      prompt: message,
      options: {
        cwd: workspacePath,
        resume: claudeCodeSessionID,
        systemPrompt: {
          preset: "claude_code",
          type: "preset",
          append: `You are a design agent named antidraw powered by claude code. Your goal is to vibe code react components from instructions of designers.

You have access to a vite project. Put your components in the src folder.

Current workspace directory: ${workspacePath}
`,
        },
        permissionMode: "bypassPermissions",
      },
    });

    return ok(res);
  } catch (_e) {
    return err("SOMETHING_WENT_WRONG" as const);
  }
};

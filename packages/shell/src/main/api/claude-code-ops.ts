import { query } from "@anthropic-ai/claude-agent-sdk";
import { ok, err } from "neverthrow";

export const sendMessage = (params: {
  message: string;
  claudeCodeSessionID?: string;
}) => {
  try {
    const { message, claudeCodeSessionID } = params;

    const res = query({
      prompt: message,
      options: {
        resume: claudeCodeSessionID,
        systemPrompt: {
          preset: "claude_code",
          type: "preset",
          append: `You are a design agent named antidraw powered by claude code. Your goal is to vibe code react components from instructions of designers.

          You have access to a vite project with a usercomponents folder. that folder you can put your components.

          current vite project directory.

          /Users/akashmohan/personal/antidraw/packages/inner/

          put the components in the usercomponents folder.

          `,
        },
        additionalDirectories: [
          "/Users/akashmohan/personal/antidraw/packages/inner/",
        ],
        permissionMode: "bypassPermissions",
      },
    });

    return ok(res);
  } catch (_e) {
    return err("SOMETHING_WENT_WRONG" as const);
  }
};

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
      },
    });

    return ok(res);
  } catch (_e) {
    return err("SOMETHING_WENT_WRONG" as const);
  }
};

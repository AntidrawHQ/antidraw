import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ok, err } from "neverthrow";
import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getWorkspaceSourcePath } from "@/main/api/init";
import type { ImageAttachment } from "@/shared/utils/message";
import { createUserSDKMessage } from "@/shared/utils/message";

const buildPrompt = (
  message: string,
  images?: ImageAttachment[]
): string | AsyncIterable<SDKUserMessage> => {
  if (!images?.length) {
    return message;
  }

  const userMessage = createUserSDKMessage({
    text: message,
    sessionId: "",
    uuid: crypto.randomUUID(),
    images,
  });

  return (async function* () {
    yield userMessage;
  })();
};

const titleGenerationSchema = z.object({
  title: z
    .string()
    .describe("3-6 word title in sentence case, captures the main task"),
  summary: z
    .string()
    .describe("1 sentence, max 100 chars, written from user's perspective (e.g. 'Creating a landing page for...' not 'User wants to create...')"),
});

export type TitleGenerationResult = z.infer<typeof titleGenerationSchema>;

export const generateTitle = async (firstMessage: string) => {
  try {
    const prompt = `Generate a title and summary for this coding conversation.

User's first message:
<message>${firstMessage}</message>`;

    const stream = query({
      prompt,
      options: {
        persistSession: false,
        permissionMode: "bypassPermissions",
        outputFormat: {
          type: "json_schema",
          schema: zodToJsonSchema(titleGenerationSchema),
        },
      },
    });

    for await (const message of stream) {
      if (
        message.type === "result" &&
        message.subtype === "success" &&
        message.structured_output
      ) {
        const parsed = titleGenerationSchema.safeParse(message.structured_output);
        if (parsed.success) {
          return ok(parsed.data);
        }
        return err("INVALID_RESPONSE" as const);
      }
    }

    return err("NO_RESULT" as const);
  } catch (e) {
    console.error("Failed to generate title:", e);
    return err("GENERATION_FAILED" as const);
  }
};

export const sendMessage = (params: {
  message: string;
  workspaceId: string;
  claudeCodeSessionID?: string;
  images?: ImageAttachment[];
}) => {
  try {
    const { message, workspaceId, claudeCodeSessionID, images } = params;
    const workspacePath = getWorkspaceSourcePath(workspaceId);

    const res = query({
      prompt: buildPrompt(message, images),
      options: {
        cwd: workspacePath,
        resume: claudeCodeSessionID,
        systemPrompt: {
          preset: "claude_code",
          type: "preset",
          append: `You are a design agent named antidraw powered by claude code. Your goal is to vibe code react components from instructions of designers.

You have access to a vite project.

IMPORTANT RULES:
- Create components ONLY in src/components/user-components/ directory
- Each component must be its own file (e.g., src/components/user-components/MyButton.tsx)
- Export components as default exports
- Avoid modifying src/main.tsx unless the user explicitly requests it and understands the risks. Warn them that modifying main.tsx can break the app or interfere with workspace updates.

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

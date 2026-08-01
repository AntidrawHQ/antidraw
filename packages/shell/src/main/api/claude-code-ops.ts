import { createRequire } from "node:module";
import path from "node:path";
import type {
  EffortLevel,
  HookInput,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

export type { EffortLevel };
import { ok, err } from "neverthrow";
import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getWorkspaceSourcePath } from "@/main/api/init";
import type { ImageAttachment } from "@/shared/utils/message";
import { createUserSDKMessage } from "@/shared/utils/message";

// The SDK auto-resolves the bundled `claude` binary via require.resolve, which
// in a packaged Electron app returns a path traversing `app.asar`. asar is a
// regular file on disk; child_process.spawn is a raw syscall that doesn't go
// through Electron's asar layer, so the kernel returns ENOTDIR. Resolve once
// and rewrite to the .unpacked sibling directory where the binary actually
// lives. In dev (no asar in the path), the replace is a no-op.
const claudeCodeExecutablePath = ((): string | undefined => {
  const requireFromHere = createRequire(import.meta.url);
  const { platform, arch } = process;
  const ext = platform === "win32" ? ".exe" : "";
  const candidates =
    platform === "linux"
      ? [
          `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude${ext}`,
          `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude${ext}`,
        ]
      : [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${ext}`];

  const sep = path.sep;
  for (const spec of candidates) {
    try {
      const resolved = requireFromHere.resolve(spec);
      return resolved.replace(
        `${sep}app.asar${sep}`,
        `${sep}app.asar.unpacked${sep}`,
      );
    } catch {
      // try next candidate
    }
  }
  return undefined;
})();

export type PromptStream = {
  prompt: AsyncIterable<SDKUserMessage>;
  push: (message: string, images?: ImageAttachment[]) => void;
  end: () => void;
};

export const buildPrompt = (
  message: string,
  images?: ImageAttachment[]
): PromptStream => {
  let closed = false;
  let controller!: ReadableStreamDefaultController<SDKUserMessage>;
  const prompt = new ReadableStream<SDKUserMessage>({
    start: (c) => (controller = c),
  });

  const push = (text: string, imgs?: ImageAttachment[]) => {
    if (closed) return;
    controller.enqueue(
      createUserSDKMessage({
        text,
        uuid: crypto.randomUUID(),
        images: imgs,
      })
    );
  };

  push(message, images);

  return {
    prompt,
    push,
    end: () => {
      if (closed) return;
      closed = true;
      controller.close();
    },
  };
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
        pathToClaudeCodeExecutable: claudeCodeExecutablePath,
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
  // message: string;
  promptStream: PromptStream;
  workspaceId: string;
  claudeCodeSessionID?: string;
  model?: string;
  effort?: EffortLevel;
  /**
   * Pin the resume point to the last assistant message we persisted, so the
   * model's memory always matches the transcript the user sees — a crashed
   * turn's unseen tail in the session file becomes a dead branch instead of
   * invisible model context. Only meaningful with `claudeCodeSessionID`.
   */
  resumeSessionAt?: string;
  /**
   * Echo of the ACTUAL effort the CLI ran the turn with (after any silent
   * downgrade for the selected model). Fired from a Stop hook; main-thread
   * turns only — subagent hook invocations are filtered out.
   */
  onEffortLevel?: (level: string) => void;
}) => {
  try {
    const {
      promptStream,
      workspaceId,
      claudeCodeSessionID,
      model,
      effort,
      resumeSessionAt,
      onEffortLevel,
    } = params;
    const workspacePath = getWorkspaceSourcePath(workspaceId);

    const res = query({
      prompt: promptStream.prompt,
      options: {
        pathToClaudeCodeExecutable: claudeCodeExecutablePath,
        cwd: workspacePath,
        resume: claudeCodeSessionID,
        ...(claudeCodeSessionID && resumeSessionAt ? { resumeSessionAt } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(onEffortLevel
          ? {
              hooks: {
                Stop: [
                  {
                    hooks: [
                      async (input: HookInput) => {
                        // agent_id present = hook fired inside a subagent;
                        // its effort must not be mirrored onto the main UI.
                        if (
                          input.hook_event_name === "Stop" &&
                          !("agent_id" in input && input.agent_id) &&
                          input.effort?.level
                        ) {
                          onEffortLevel(input.effort.level);
                        }
                        return {};
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
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
        includePartialMessages: true,
      },
    });

    return ok(res);
  } catch (_e) {
    return err("SOMETHING_WENT_WRONG" as const);
  }
};

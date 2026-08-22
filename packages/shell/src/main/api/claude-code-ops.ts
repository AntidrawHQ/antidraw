import { createRequire } from "node:module";
import path from "node:path";
import type { UUID } from "node:crypto";
import type {
  EffortLevel,
  HookInput,
  ModelInfo,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

export type { EffortLevel, ModelInfo };
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
export const claudeCodeExecutablePath = ((): string | undefined => {
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

export type PromptPushOptions = {
  // Stamped onto the SDKUserMessage as its uuid. With --replay-user-messages
  // the CLI echoes it back (isReplay: true) when the message is folded into
  // a turn — that echo is the acceptance ack the queueing UX correlates on,
  // so callers pass the frontend's userMessageId here.
  uuid?: UUID;
  images?: ImageAttachment[];
};

export type PromptStream = {
  prompt: AsyncIterable<SDKUserMessage>;
  push: (message: string, options?: PromptPushOptions) => void;
  end: () => void;
};

export const buildPrompt = (
  message: string,
  options?: PromptPushOptions
): PromptStream => {
  let closed = false;
  let controller!: ReadableStreamDefaultController<SDKUserMessage>;
  const prompt = new ReadableStream<SDKUserMessage>({
    start: (c) => (controller = c),
  });

  const push = (text: string, opts?: PromptPushOptions) => {
    if (closed) return;
    controller.enqueue(
      createUserSDKMessage({
        text,
        uuid: opts?.uuid ?? crypto.randomUUID(),
        images: opts?.images,
      })
    );
  };

  push(message, options);

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

// The CLI's model catalog, fetched once per session. supportedModels()
// resolves from the initialize handshake — the throwaway query below never
// starts a turn (its prompt stream never yields) and is aborted the moment
// the handshake lands, so this costs one short-lived CLI spawn and zero
// tokens. Cached for the process lifetime: the catalog is pinned to the
// bundled CLI binary, which can only change across an app update/restart.
let modelCatalog: Promise<ModelInfo[]> | null = null;

export const getSupportedModels = (): Promise<ModelInfo[]> => {
  if (modelCatalog) return modelCatalog;
  const fetching = (async () => {
    const abortController = new AbortController();
    const never = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise(() => {});
    })();
    const q = query({
      prompt: never,
      options: {
        pathToClaudeCodeExecutable: claudeCodeExecutablePath,
        persistSession: false,
        abortController,
      },
    });
    try {
      return await q.supportedModels();
    } finally {
      abortController.abort();
    }
  })();
  modelCatalog = fetching;
  // A failed spawn must not poison the session cache — let the next request
  // retry. (The renderer falls back to its placeholder catalog meanwhile.)
  fetching.catch(() => {
    if (modelCatalog === fetching) modelCatalog = null;
  });
  return fetching;
};

export const sendMessage = (params: {
  // message: string;
  promptStream: PromptStream;
  workspaceId: string;
  claudeCodeSessionID?: string;
  model?: string;
  effort?: EffortLevel;
  /**
   * Echo of the ACTUAL effort the CLI ran the turn with (after any silent
   * downgrade for the selected model). Fired from a Stop hook; main-thread
   * turns only — subagent hook invocations are filtered out. Nothing
   * persists or displays this today: it is kept wired as the signal for
   * future product feedback when the CLI deviates from the user's
   * selection.
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
      onEffortLevel,
    } = params;
    const workspacePath = getWorkspaceSourcePath(workspaceId);

    const res = query({
      prompt: promptStream.prompt,
      options: {
        pathToClaudeCodeExecutable: claudeCodeExecutablePath,
        cwd: workspacePath,
        resume: claudeCodeSessionID,
        model,
        effort,
        hooks: onEffortLevel
          ? {
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
            }
          : undefined,
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
        // Ask the CLI to re-emit each stdin user message once it is folded
        // into a turn ({type:"user", isReplay:true, uuid}). That replay is the
        // only acceptance signal there is for a pushed message — the SDK's
        // streamInput just writes to stdin. Not a first-class SDK option,
        // only the CLI flag (verified live: without it, no ack ever comes).
        extraArgs: { "replay-user-messages": null },
        // Make the CLI report its session state ({type:"system",
        // subtype:"session_state_changed", state:"running"|"idle"|
        // "requires_action"}). `idle` fires only when the turn AND the CLI's
        // command queue are fully drained, which is the end-of-turn signal
        // the stream lifecycle keys on — `result` is not one (a queued
        // follow-up runs after it with no idle in between). Gated behind an
        // env var rather than an option; the SDK merges this into the child
        // env. Verified live against the pinned CLI.
        env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" },
      },
    });

    return ok(res);
  } catch (_e) {
    return err("SOMETHING_WENT_WRONG" as const);
  }
};

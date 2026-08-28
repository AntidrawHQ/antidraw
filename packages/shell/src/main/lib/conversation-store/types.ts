import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { PromptStream } from "@/main/api/claude-code-ops";
import type { LivePartial } from "@/shared/utils/live-partial";

export type CliSessionState =
  | "spawning"
  | "running"
  | "requires_action"
  | "idle";

// Which side of the fork a send landed on: it either has to start the CLI,
// or a CLI is already there and it is a follow-up into the live one.
export type TurnType = "cold-start" | "follow-up";

export type CliHandle = {
  readonly conversationId: string;
  query: Query | null;
  readonly promptStream: PromptStream;
  cliState: CliSessionState;
  readonly pendingUserMessageIds: Set<string>;
  partial: LivePartial | null;
};

import type { ToolPart } from "@/renderer/components/ui/tool";
import type { ConversationWithMessages } from "@/main/api";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { LivePartial } from "./stream-subscription";

// Union of all content block types from the SDK
type AnyContentBlock = BetaContentBlock | ContentBlockParam;

// Extract tool use blocks from SDK types (blocks with id, name, input)
type ToolUseBlock = Extract<
  AnyContentBlock,
  { id: string; name: string; input: unknown }
>;

// Extract tool result blocks from SDK types (blocks with tool_use_id)
type ToolResultBlock = Extract<AnyContentBlock, { tool_use_id: string }>;

// Type guard for tool use blocks
function isToolUseBlock(block: AnyContentBlock): block is ToolUseBlock {
  return "id" in block && "name" in block && "input" in block;
}

// Type guard for tool result blocks
function isToolResultBlock(block: AnyContentBlock): block is ToolResultBlock {
  return "tool_use_id" in block;
}

export type ToolImage = { mediaType: string; data: string };

const isBase64Image = (
  block: unknown,
): block is { type: "image"; source: { type: "base64"; media_type: string; data: string } } =>
  typeof block === "object" &&
  block !== null &&
  (block as { type?: unknown }).type === "image" &&
  (block as { source?: { type?: unknown } }).source?.type === "base64";

// A result's text, with its images (a Read of a screenshot) split out. As
// JSON they were the base64 of every screenshot, stringified again on every
// correlate and dumped into the row as text.
function extractResult(content: unknown): { text: string; images: ToolImage[] } {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) {
    return { text: content != null ? JSON.stringify(content, null, 2) : "", images: [] };
  }
  const text: string[] = [];
  const images: ToolImage[] = [];
  for (const block of content) {
    if (isBase64Image(block)) {
      images.push({ mediaType: block.source.media_type, data: block.source.data });
    } else if (block?.type === "text" && typeof block.text === "string") {
      text.push(block.text);
    } else {
      text.push(JSON.stringify(block, null, 2));
    }
  }
  return { text: text.join("\n"), images };
}

export function correlateTools(
  messages: ConversationWithMessages["messages"]
): Map<string, ToolPart> {
  const toolMap = new Map<string, ToolPart>();

  for (const message of messages) {
    const sdkMessage = message.sdkMessage;

    // Only process user and assistant messages with content
    if (sdkMessage.type !== "user" && sdkMessage.type !== "assistant") {
      continue;
    }

    const content = sdkMessage.message.content;

    if (!Array.isArray(content)) {
      continue;
    }

    // tool_use_result is per message, not per block. The CLI writes one
    // tool_result per message, so it belongs to that one; a message carrying
    // several cannot say which, and gives none of them a structured output.
    const structuredOutput =
      sdkMessage.type === "user" &&
      content.filter((b) => isToolResultBlock(b)).length === 1
        ? sdkMessage.tool_use_result
        : undefined;

    for (const block of content) {
      // Handle any tool use block (tool_use, mcp_tool_use, etc.)
      if (isToolUseBlock(block)) {
        toolMap.set(block.id, {
          type: block.name,
          state: "input-available",
          input: block.input as Record<string, unknown>,
        });
      }

      // Handle any tool result block (tool_result, mcp_tool_result, web_search_tool_result, etc.)
      if (isToolResultBlock(block)) {
        const existing = toolMap.get(block.tool_use_id);
        if (existing) {
          const isError = "is_error" in block && block.is_error === true;
          existing.state = isError ? "output-error" : "output-available";

          const { text, images } = extractResult(block.content);
          existing.output = images.length ? { result: text, images } : { result: text };

          if (isError) {
            existing.errorText = text;
          }

          if (structuredOutput !== undefined) {
            existing.structuredOutput = structuredOutput;
          }
        }
      }
    }
  }

  return toolMap;
}

const EMPTY_TOOL_MAP: Map<string, ToolPart> = new Map();
export const emptyToolMap = (): Map<string, ToolPart> => EMPTY_TOOL_MAP;

// correlateTools builds fresh ToolPart objects on every run, so on its own
// every tool would look changed whenever any message arrived. Carrying over
// the previous object where nothing about the tool differs keeps identities
// stable, which is what lets a memoized row skip re-rendering.
export const reuseToolParts = (
  previous: ReadonlyMap<string, ToolPart>,
  next: Map<string, ToolPart>,
): Map<string, ToolPart> => {
  for (const [id, part] of next) {
    const old = previous.get(id);
    if (
      old &&
      old.type === part.type &&
      old.state === part.state &&
      old.input === part.input &&
      old.errorText === part.errorText &&
      old.structuredOutput === part.structuredOutput &&
      old.output?.result === part.output?.result
    ) {
      next.set(id, old);
    }
  }
  return next;
};

// Matches ".../user-components/Card.tsx" and captures "Card". Files in a
// subfolder don't match: only top-level files are components on the canvas.
const COMPONENT_FILE_RE = /user-components\/([^\s"'`/\\]+)\.tsx\b/;

/**
 * The component a finished tool call touched, if any. Write, Edit and Read
 * name the file in `file_path`; Bash names it somewhere in `command` (sed -i,
 * a heredoc, a python script…). Calls that are still running or failed return
 * null: the component isn't on disk yet, or never made it.
 */
export const viewableComponent = (toolPart: ToolPart): string | null => {
  if (toolPart.state !== "output-available") return null;
  const { file_path, command } = toolPart.input ?? {};
  const text =
    typeof file_path === "string" ? file_path
    : typeof command === "string" ? command
    : null;
  return text?.match(COMPONENT_FILE_RE)?.[1] ?? null;
};

// The in-flight tool_use block, shaped for the Tool component. Not part of the
// persisted map: it changes every frame while it streams, and folding it into
// that map would hand every row a new map each time.
export const liveToolPart = (live: LivePartial): ToolPart | null =>
  live.block.type === "tool_use"
    ? {
        type: live.block.name,
        state: "input-streaming",
        input: live.block.input as Record<string, unknown>,
      }
    : null;

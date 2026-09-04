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

// Extract string content from various result formats
function extractResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content != null) {
    return JSON.stringify(content, null, 2);
  }
  return "";
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

          const resultContent = extractResultContent(block.content);
          existing.output = { result: resultContent };

          if (isError) {
            existing.errorText = resultContent;
          }
        }
      }
    }
  }

  return toolMap;
}

export const selectToolMap = (
  data: ConversationWithMessages,
  live: LivePartial | null = null,
): Map<string, ToolPart> => {
  const map = correlateTools(data.messages);

  // At most one in-flight block. Only merge it if it's a tool_use we don't yet have persisted.
  if (live?.block.type === "tool_use" && !map.has(live.block.id)) {
    map.set(live.block.id, {
      type: live.block.name,
      state: "input-streaming",
      input: live.block.input as Record<string, unknown>,
    });
  }

  return map;
};

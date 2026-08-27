import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages";
import { parsePartialJson } from "./parse-partial-json";

// The in-flight content block — stored as the SDK's own BetaContentBlock,
// with `partialJson` as a sibling string accumulator for tool_use blocks
// (the SDK doesn't expose this — it parses internally on content_block_stop).
export type LivePartial = {
  index: number;
  block: BetaContentBlock;
  partialJson?: string;
};

type RawStreamEvent = SDKPartialAssistantMessage["event"];

// Folds one raw stream event into the in-flight block. Shared because both
// sides need the identical result: main keeps it so a subscriber arriving
// mid-block can be seeded with the text so far, and the renderer applies the
// same deltas live. Two implementations would drift, and the symptom would be
// a reconnect that renders subtly different text than the one that stayed.
export const foldPartial = (
  prev: LivePartial | null,
  raw: RawStreamEvent,
): LivePartial | null => {
  // Only content_block_start and content_block_delta mutate live state.
  // message_start/delta/stop and content_block_stop are ignored:
  // - content_block_stop is redundant; persisted assistant messages clear it.
  // - message_* events carry no per-block info we render.
  if (raw.type !== "content_block_start" && raw.type !== "content_block_delta") {
    return prev;
  }

  // SEED: store the SDK's content_block as-is; init partialJson only for tool_use.
  if (raw.type === "content_block_start") {
    return {
      index: raw.index,
      block: raw.content_block as BetaContentBlock,
      partialJson: raw.content_block.type === "tool_use" ? "" : undefined,
    };
  }

  // APPEND: mutate the single in-flight block.
  if (!prev || prev.index !== raw.index) return prev;
  const b = prev.block;
  const delta = raw.delta;

  if (delta.type === "text_delta" && b.type === "text") {
    return { ...prev, block: { ...b, text: b.text + delta.text } };
  }
  if (delta.type === "thinking_delta" && b.type === "thinking") {
    return { ...prev, block: { ...b, thinking: b.thinking + delta.thinking } };
  }
  if (delta.type === "input_json_delta" && b.type === "tool_use") {
    const partialJson = (prev.partialJson ?? "") + delta.partial_json;
    const parsed = parsePartialJson(partialJson);
    return { ...prev, partialJson, block: { ...b, input: parsed ?? b.input } };
  }
  // signature_delta and any unknown delta: ignored
  return prev;
};

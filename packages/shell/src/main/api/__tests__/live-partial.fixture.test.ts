import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";
import type { SDKMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages";
import { foldPartial, type LivePartial } from "@/shared/utils/live-partial";

// A real turn, recorded off the real CLI by fixtures/record.test.ts — a tool
// call plus prose, so the stream carries thinking, tool_use and text blocks.
// Replaying it offline is what lets the fold be checked against traffic the
// model actually produced rather than wire shapes I imagined.
const FIXTURE = fileURLToPath(new URL("./fixtures/partials.jsonl", import.meta.url));

const messages: SDKMessage[] = readFileSync(FIXTURE, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as SDKMessage);

const streamEvents = messages
  .filter((m): m is SDKPartialAssistantMessage => m.type === "stream_event")
  .map((m) => m.event);

// What the SDK itself assembled — the answer key.
const finalBlocks = messages.flatMap((m) =>
  m.type === "assistant"
    ? ((m.message.content as BetaContentBlock[]) ?? [])
    : [],
);

// Replay exactly as production does, capturing each block as it completes.
// foldPartial keeps only the block in flight, so a block has to be read at its
// content_block_stop, before the next start replaces it.
const replay = (upTo = streamEvents.length) => {
  const completed: LivePartial[] = [];
  let live: LivePartial | null = null;
  for (const event of streamEvents.slice(0, upTo)) {
    if (event.type === "content_block_stop" && live) completed.push(live);
    live = foldPartial(live, event);
  }
  return { completed, live };
};

describe("foldPartial against a recorded stream", () => {
  // A re-record that loses a block type — or thins one out to a single delta —
  // quietly stops testing the guarantees below. Minimums, not just presence:
  // an earlier recording had exactly ONE text_delta, so text accumulation was
  // effectively untested while every assertion still passed.
  test("the fixture still covers every block and delta type, in volume", () => {
    const count = (pred: (e: (typeof streamEvents)[number]) => boolean) =>
      streamEvents.filter(pred).length;
    const deltas = (type: string) =>
      count((e) => e.type === "content_block_delta" && e.delta.type === type);

    const blocks = finalBlocks.reduce<Record<string, number>>((acc, b) => {
      acc[b.type] = (acc[b.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(Object.keys(blocks).sort()).toEqual(["text", "thinking", "tool_use"]);
    expect(blocks.thinking).toBeGreaterThanOrEqual(3);
    expect(blocks.tool_use).toBeGreaterThanOrEqual(3);
    expect(blocks.text).toBeGreaterThanOrEqual(2);

    // Several deltas each, so accumulation is exercised rather than a single
    // delta that a broken fold could still pass by returning the seed.
    expect(deltas("text_delta")).toBeGreaterThanOrEqual(5);
    expect(deltas("thinking_delta")).toBeGreaterThanOrEqual(5);
    expect(deltas("input_json_delta")).toBeGreaterThanOrEqual(5);
    expect(deltas("signature_delta")).toBeGreaterThanOrEqual(1);

    // More than one turn, so a follow-up into a live session is covered too.
    expect(count((e) => e.type === "message_start")).toBeGreaterThanOrEqual(3);
  });

  test("a block accumulated from many deltas is not just its seed", () => {
    const { completed } = replay();
    // The failure this guards: a fold that drops every delta still "passes"
    // shape checks, because content_block_start already carries a valid block.
    const grown = completed.filter((p) => {
      const b = p.block as { text?: string; thinking?: string };
      return (b.text ?? b.thinking ?? "").length > 40;
    });
    expect(grown.length).toBeGreaterThanOrEqual(2);
  });

  test("replaying the deltas reproduces the SDK's own blocks", () => {
    const { completed } = replay();
    expect(completed).toHaveLength(finalBlocks.length);

    completed.forEach((partial, i) => {
      const expected = finalBlocks[i]!;
      const actual = partial.block;
      expect(actual.type).toBe(expected.type);

      if (expected.type === "text" && actual.type === "text") {
        expect(actual.text).toBe(expected.text);
      }
      if (expected.type === "thinking" && actual.type === "thinking") {
        expect(actual.thinking).toBe(expected.thinking);
      }
      // The whole point of accumulating the json ourselves: the SDK only
      // exposes `input` once the block is finished.
      if (expected.type === "tool_use" && actual.type === "tool_use") {
        expect(actual.input).toEqual(expected.input);
        expect(actual.name).toBe(expected.name);
        expect(JSON.parse(partial.partialJson!)).toEqual(expected.input);
      }
    });
  });

  // Deliberate divergence, asserted so it stays deliberate: signature_delta is
  // ignored. The signature is what you would send back to the API to reuse a
  // thinking block; nothing renders it, and the persisted assistant row keeps
  // the complete one. If the fold ever needs to round-trip thinking, this is
  // the test that should fail first.
  test("thinking signatures are not accumulated, though the text is", () => {
    const { completed } = replay();
    const foldedThinking = completed.filter((p) => p.block.type === "thinking");
    const realThinking = finalBlocks.filter((b) => b.type === "thinking");

    expect(foldedThinking.length).toBeGreaterThan(0);
    foldedThinking.forEach((p, i) => {
      const block = p.block as { thinking: string; signature?: string };
      const real = realThinking[i] as { thinking: string; signature?: string };
      expect(block.thinking).toBe(real.thinking);
      expect(block.signature ?? "").not.toBe(real.signature);
      expect(real.signature).toBeTruthy();
    });
  });

  test("a tool call's arguments parse while still arriving", () => {
    const firstToolStart = streamEvents.findIndex(
      (e) => e.type === "content_block_start" && e.content_block.type === "tool_use",
    );
    const jsonDeltas = streamEvents
      .map((e, i) => ({ e, i }))
      .filter(({ e, i }) => i > firstToolStart && e.type === "content_block_delta" && e.delta.type === "input_json_delta");

    // Stop one delta short of complete: the args must already be a usable
    // object, which is what lets a tool call render before it finishes.
    const midway = jsonDeltas[jsonDeltas.length - 2]!.i + 1;
    const { live } = replay(midway);

    expect(live!.block.type).toBe("tool_use");
    expect(live!.partialJson!.length).toBeGreaterThan(0);
    // Truncated json — JSON.parse would throw here; parsePartialJson does not.
    expect(() => JSON.parse(live!.partialJson!)).toThrow();
    expect((live!.block as { input: unknown }).input).toBeTypeOf("object");
  });

  test("events that are not content_block_* leave the block untouched", () => {
    const ignored = streamEvents.filter(
      (e) => e.type !== "content_block_start" && e.type !== "content_block_delta",
    );
    expect(ignored.length).toBeGreaterThan(0);

    const seeded = replay(
      streamEvents.findIndex((e) => e.type === "content_block_delta") + 1,
    ).live;
    for (const event of ignored) {
      expect(foldPartial(seeded, event)).toBe(seeded);
    }
    // ...and they cannot conjure a block out of nothing either.
    for (const event of ignored) {
      expect(foldPartial(null, event)).toBeNull();
    }
  });

  test("a delta with no block in flight is dropped", () => {
    const delta = streamEvents.find((e) => e.type === "content_block_delta")!;
    expect(foldPartial(null, delta)).toBeNull();
  });
});

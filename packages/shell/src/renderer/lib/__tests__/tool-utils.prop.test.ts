import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ConversationWithMessages } from "@/main/api";
import { correlateTools } from "../tool-utils";

// Property tests: fast-check generates inputs, and a failure prints the
// smallest input it could shrink to, plus a seed to replay it.

type Msgs = ConversationWithMessages["messages"];

const message = (type: "assistant" | "user", content: unknown[]) =>
  ({ sdkMessage: { type, message: { content } } }) as unknown as Msgs[number];

const image = fc
  .record({
    mediaType: fc.constantFrom("image/png", "image/jpeg", "image/webp"),
    data: fc.base64String({ minLength: 4, maxLength: 64 }),
  })
  .map(({ mediaType, data }) => ({
    type: "image",
    source: { type: "base64", media_type: mediaType, data },
  }));
const text = fc.string({ maxLength: 20 }).map((t) => ({ type: "text", text: t }));
// Anything else a result can carry, such as a tool_reference.
const other = fc.record({ type: fc.constantFrom("tool_reference", "document"), id: fc.nat() });

const correlate = (content: unknown, isError: boolean) =>
  correlateTools([
    message("assistant", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.png" } }]),
    message("user", [{ type: "tool_result", tool_use_id: "t1", content, is_error: isError }]),
  ]).get("t1")!;

describe("correlateTools result properties", () => {
  it("splits images out of a result, in order, keeping the rest as text", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(image, text, other), { maxLength: 6 }), fc.boolean(), (blocks, isError) => {
        const part = correlate(blocks, isError);
        const images = blocks.filter((b) => b.type === "image") as { source: { media_type: string; data: string } }[];
        const rest = blocks.filter((b) => b.type !== "image");
        const expectedText = rest
          .map((b) => ("text" in b && typeof b.text === "string" ? b.text : JSON.stringify(b, null, 2)))
          .join("\n");

        expect(part.output?.result).toBe(expectedText);
        expect(part.output?.images).toEqual(
          images.length ? images.map((b) => ({ mediaType: b.source.media_type, data: b.source.data })) : undefined,
        );
        expect(part.state).toBe(isError ? "output-error" : "output-available");
        if (isError) expect(part.errorText).toBe(expectedText);
      }),
      { numRuns: 300 },
    );
  });

  it("passes a string result through untouched", () => {
    fc.assert(
      fc.property(fc.string(), (result) => {
        const part = correlate(result, false);
        expect(part.output).toEqual({ result });
      }),
    );
  });
});

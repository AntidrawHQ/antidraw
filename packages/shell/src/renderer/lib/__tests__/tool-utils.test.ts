import { describe, test, expect } from "vitest";
import type { ConversationWithMessages } from "@/main/api";
import { correlateTools, reuseToolParts } from "../tool-utils";

type Msgs = ConversationWithMessages["messages"];

const assistantWithTool = (id: string, input: Record<string, unknown>) =>
  ({
    sdkMessage: {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id, name: "Write", input }],
      },
    },
  }) as unknown as Msgs[number];

const toolResult = (id: string, content: string) =>
  ({
    sdkMessage: {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content }],
      },
    },
  }) as unknown as Msgs[number];

describe("reuseToolParts", () => {
  test("keeps the previous object for a tool that did not change", () => {
    const a = assistantWithTool("t1", { file_path: "/a" });
    const before = correlateTools([a]);
    const b = assistantWithTool("t2", { file_path: "/b" });
    const after = reuseToolParts(before, correlateTools([a, b]));

    expect(after.get("t1")).toBe(before.get("t1"));
    expect(after.has("t2")).toBe(true);
  });

  test("hands out a new object once the tool gets its result", () => {
    const a = assistantWithTool("t1", { file_path: "/a" });
    const before = correlateTools([a]);
    const after = reuseToolParts(
      before,
      correlateTools([a, toolResult("t1", "done")]),
    );

    expect(after.get("t1")).not.toBe(before.get("t1"));
    expect(after.get("t1")?.state).toBe("output-available");
  });

  test("a finished tool keeps its identity across later messages", () => {
    const a = assistantWithTool("t1", { file_path: "/a" });
    const r = toolResult("t1", "done");
    const before = correlateTools([a, r]);
    const after = reuseToolParts(
      before,
      correlateTools([a, r, assistantWithTool("t2", {})]),
    );

    expect(after.get("t1")).toBe(before.get("t1"));
  });
});

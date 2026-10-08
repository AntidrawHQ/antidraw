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

  // State alone is not enough to call a tool unchanged: a memoized row keyed on
  // the part's identity would go on showing the old input or result.
  test("hands out a new object when the input changes and the state does not", () => {
    const before = correlateTools([assistantWithTool("t1", { file_path: "/a" })]);
    const after = reuseToolParts(
      before,
      correlateTools([assistantWithTool("t1", { file_path: "/b" })]),
    );

    expect(after.get("t1")?.state).toBe(before.get("t1")?.state);
    expect(after.get("t1")).not.toBe(before.get("t1"));
    expect(after.get("t1")?.input).toEqual({ file_path: "/b" });
  });

  test("hands out a new object when the result changes and the state does not", () => {
    const a = assistantWithTool("t1", { file_path: "/a" });
    const before = correlateTools([a, toolResult("t1", "first")]);
    const after = reuseToolParts(
      before,
      correlateTools([a, toolResult("t1", "second")]),
    );

    expect(after.get("t1")?.state).toBe("output-available");
    expect(after.get("t1")).not.toBe(before.get("t1"));
    expect(after.get("t1")?.output?.result).toBe("second");
  });
});

describe("structured output", () => {
  const askUserQuestion = (id: string) =>
    ({
      sdkMessage: {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id,
              name: "AskUserQuestion",
              input: { questions: [] },
            },
          ],
        },
      },
    }) as unknown as Msgs[number];

  const resultWith = (
    blocks: { id: string; content: string }[],
    toolUseResult: unknown,
  ) =>
    ({
      sdkMessage: {
        type: "user",
        tool_use_result: toolUseResult,
        message: {
          content: blocks.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: b.content,
          })),
        },
      },
    }) as unknown as Msgs[number];

  test("a tool's tool_use_result rides along on its part", () => {
    const tools = correlateTools([
      askUserQuestion("t1"),
      resultWith([{ id: "t1", content: "User has answered" }], {
        answers: { "Which layout?": "Split hero" },
      }),
    ]);

    expect(tools.get("t1")).toMatchInlineSnapshot(`
      {
        "input": {
          "questions": [],
        },
        "output": {
          "result": "User has answered",
        },
        "state": "output-available",
        "structuredOutput": {
          "answers": {
            "Which layout?": "Split hero",
          },
        },
        "type": "AskUserQuestion",
      }
    `);
  });

  test("a message with several results gives none of them its tool_use_result", () => {
    const tools = correlateTools([
      askUserQuestion("t1"),
      askUserQuestion("t2"),
      resultWith(
        [
          { id: "t1", content: "one" },
          { id: "t2", content: "two" },
        ],
        { answers: { q: "a" } },
      ),
    ]);

    expect([...tools.values()].map((t) => t.structuredOutput)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("a changed structured output is a changed part", () => {
    const ask = askUserQuestion("t1");
    const before = correlateTools([
      ask,
      resultWith([{ id: "t1", content: "x" }], { answers: { q: "a" } }),
    ]);
    const after = reuseToolParts(
      before,
      correlateTools([
        ask,
        resultWith([{ id: "t1", content: "x" }], { answers: { q: "b" } }),
      ]),
    );

    expect(after.get("t1")).not.toBe(before.get("t1"));
  });
});

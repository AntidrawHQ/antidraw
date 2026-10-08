import { z } from "zod";

// AskUserQuestion is built into the CLI, not one of our MCP tools: it reaches
// the host through canUseTool (main) and the persisted tool_use block
// (renderer). Both sides read its input through this one schema, so neither
// can drift from the other. The SDK's own type (AskUserQuestionInput in
// @anthropic-ai/claude-agent-sdk/sdk-tools) is types-only — this is the
// runtime check of the part we read.
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

// The deny messages are what the model reads in the tool_result, so they say
// what happened from its side. Shared so the card can say which of them
// settled a question.
export const DENY_MESSAGES = {
  // A tool other than AskUserQuestion asking for permission. Under
  // bypassPermissions that is only an ask the CLI forces past the bypass — a
  // safety check, an ask rule, an interactive tool — and none of those have a
  // prompt in antidraw. Allowing them here would quietly widen what bypass
  // grants; denying keeps it exactly as strict as before there was a
  // callback. (The callback also turns tools on — the plan-mode ones —
  // which sendMessage disallows, since this deny would strand them.)
  unsupported: (toolName: string) =>
    `${toolName} needs the user's approval, and antidraw has no prompt for it. Do not retry; continue without it or ask the user in plain text.`,
  // An AskUserQuestion input the card cannot draw. Parking it would block the
  // CLI on a question nobody can see to answer or skip.
  unreadable:
    "The question could not be shown to the user: its input was not in the expected shape. Ask in plain text instead.",
  cancelled: "The user stopped the turn before answering.",
  declined: "The user declined to answer. Continue without their input, or ask in plain text.",
  ended: "The session ended before the user answered.",
  noHandle: "The question could not be shown to the user.",
} as const;

// Loose on purpose. The CLI already validated the input against the tool's
// schema before asking, and its counts (1–4 questions, 2–4 options) are its
// to enforce; this only proves the fields we render and key answers on are
// there. Unknown fields pass through, because the answer must hand every
// field back unchanged.
export const askUserQuestionInputSchema = z.looseObject({
  questions: z
    .array(
      z.looseObject({
        question: z.string().min(1),
        header: z.string(),
        options: z.array(
          z.looseObject({
            label: z.string().min(1),
            description: z.string(),
            preview: z.string().optional(),
          }),
        ),
        multiSelect: z.boolean().optional(),
      }),
    )
    .min(1),
});

export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;
export type AskUserQuestionItem = AskUserQuestionInput["questions"][number];

// What the renderer sends: per question text, the chosen label, a typed
// "Other" answer, or — for a multi-select question — several of either.
export type AskUserQuestionAnswers = Record<string, string | string[]>;

export const parseAskUserQuestionInput = (
  input: unknown,
): AskUserQuestionInput | null => {
  const parsed = askUserQuestionInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

// The answers the tool ran with, from the persisted tool_result message's
// tool_use_result (the tool's AskUserQuestionOutput). Null for anything else
// — a declined or cancelled question has an error result and no answers.
export const answersFromToolUseResult = (
  toolUseResult: unknown,
): Record<string, string> | null => {
  const parsed = z
    .object({ answers: z.record(z.string(), z.string()) })
    .safeParse(toolUseResult);
  return parsed.success ? parsed.data.answers : null;
};

// The labels of a multi-select answer, split back out of the CLI's join (see
// joinMultiSelect in main): ", " between labels, a label that holds ", " or a
// quote JSON-quoted.
export const splitMultiSelect = (joined: string): string[] => {
  const labels: string[] = [];
  let rest = joined;
  while (rest) {
    const quoted = rest.match(/^"(?:[^"\\]|\\.)*"/);
    const end = quoted ? quoted[0].length : rest.indexOf(", ") < 0 ? rest.length : rest.indexOf(", ");
    labels.push(quoted ? (JSON.parse(quoted[0]) as string) : rest.slice(0, end));
    rest = rest.slice(end).replace(/^, /, "");
  }
  return labels;
};

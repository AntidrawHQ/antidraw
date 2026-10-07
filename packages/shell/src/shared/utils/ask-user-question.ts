import { z } from "zod";

// AskUserQuestion is built into the CLI, not one of our MCP tools: it reaches
// the host through canUseTool (main) and the persisted tool_use block
// (renderer). Both sides read its input through this one schema, so neither
// can drift from the other. The SDK's own type (AskUserQuestionInput in
// @anthropic-ai/claude-agent-sdk/sdk-tools) is types-only — this is the
// runtime check of the part we read.
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

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

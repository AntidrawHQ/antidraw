import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { ok, err, type Result } from "neverthrow";
import {
  ASK_USER_QUESTION_TOOL,
  parseAskUserQuestionInput,
  type AskUserQuestionAnswers,
} from "@/shared/utils/ask-user-question";
import {
  addPendingQuestion,
  getPendingQuestion,
  settleQuestion,
} from "@/main/lib/conversation-store";

// The deny messages are what the model reads in the tool_result, so they say
// what happened from its side.
export const DENY_MESSAGES = {
  // A tool other than AskUserQuestion asking for permission. Under
  // bypassPermissions that is only an ask the CLI forces past the bypass — a
  // safety check, an ask rule, an interactive tool — and none of those have a
  // prompt in antidraw. Allowing them here would quietly widen what bypass
  // grants; denying keeps it exactly as strict as before there was a
  // callback.
  unsupported: (toolName: string) =>
    `${toolName} needs the user's approval, and antidraw has no prompt for it. Do not retry; continue without it or ask the user in plain text.`,
  cancelled: "The user stopped the turn before answering.",
  declined: "The user declined to answer. Continue without their input, or ask in plain text.",
  ended: "The session ended before the user answered.",
  noHandle: "The question could not be shown to the user.",
} as const;

// The CLI's own spelling for a multi-select answer: labels joined with ", ",
// any label that contains ", " or a quote JSON-quoted so the join can be split
// back apart. Joined here rather than sent as an array — a string is what the
// tool's answers field holds, whichever path the CLI validates it on.
const joinMultiSelect = (labels: string[]): string =>
  labels
    .map((l) => (l.includes(", ") || l.includes('"') ? JSON.stringify(l) : l))
    .join(", ");

export type AnswerError = {
  code:
    | "INVALID_INPUT"
    | "UNKNOWN_QUESTION"
    | "MISSING_ANSWER"
    | "EMPTY_ANSWER"
    | "NOT_MULTI_SELECT"
    | "TOO_MANY_ANSWERS";
  message: string;
};

// The tool's input with the user's answers added — the `updatedInput` the CLI
// runs the tool with. Every field of the input comes back as it was: the CLI
// rejects an answer that changes anything it showed (changed_shown_field), so
// this only ever adds `answers`.
//
// Checked here because a bad answer that reaches the CLI fails as a vague
// rejection on its side; here it is a 400 with a reason. Every question must
// be answered — the CLI would take a partial set, but the card never sends one,
// so a partial set means something is wrong.
export const buildAnswer = (
  input: Record<string, unknown>,
  answers: AskUserQuestionAnswers,
): Result<Record<string, unknown>, AnswerError> => {
  const parsed = parseAskUserQuestionInput(input);
  if (!parsed) {
    return err({ code: "INVALID_INPUT", message: "The question's input is not an AskUserQuestion input." });
  }

  const byText = new Map(parsed.questions.map((q) => [q.question, q]));
  for (const key of Object.keys(answers)) {
    if (!byText.has(key)) {
      return err({ code: "UNKNOWN_QUESTION", message: `No question reads "${key}".` });
    }
  }

  const out: Record<string, string> = {};
  for (const q of parsed.questions) {
    const answer = answers[q.question];
    if (answer === undefined) {
      return err({ code: "MISSING_ANSWER", message: `"${q.question}" has no answer.` });
    }
    const values = typeof answer === "string" ? [answer] : answer;
    if (values.length === 0 || values.some((v) => v.trim() === "")) {
      return err({ code: "EMPTY_ANSWER", message: `"${q.question}" has an empty answer.` });
    }
    if (typeof answer === "string") {
      out[q.question] = answer;
      continue;
    }
    if (!q.multiSelect) {
      return err({ code: "NOT_MULTI_SELECT", message: `"${q.question}" takes one answer.` });
    }
    // Every option, plus one typed "Other".
    if (values.length > q.options.length + 1) {
      return err({ code: "TOO_MANY_ANSWERS", message: `"${q.question}" has more answers than options.` });
    }
    out[q.question] = joinMultiSelect(values);
  }

  return ok({ ...input, answers: out });
};

// The canUseTool callback for one conversation's query. AskUserQuestion is
// parked in the store until the user answers; every other tool is denied (see
// DENY_MESSAGES.unsupported).
//
// The promise settles exactly once, through the store: an answer or a decline
// from the routes, the abort signal (Stop — the SDK aborts it when the CLI
// cancels the request), or clearPendingQuestions when the turn ends.
export const createCanUseTool =
  (conversationId: string): CanUseTool =>
  async (toolName, input, { signal, toolUseID }) => {
    if (toolName !== ASK_USER_QUESTION_TOOL) {
      return { behavior: "deny", message: DENY_MESSAGES.unsupported(toolName) };
    }
    if (signal.aborted) {
      return { behavior: "deny", message: DENY_MESSAGES.cancelled };
    }

    return new Promise<PermissionResult>((resolve) => {
      const onAbort = () =>
        settleQuestion(conversationId, toolUseID, {
          behavior: "deny",
          message: DENY_MESSAGES.cancelled,
        });
      const parked = addPendingQuestion(conversationId, toolUseID, {
        input,
        settle: (result) => {
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
      });
      if (!parked) {
        resolve({ behavior: "deny", message: DENY_MESSAGES.noHandle });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

export type AnswerQuestionError =
  | { status: 404; code: "NOT_PENDING"; message: string }
  | ({ status: 400 } & AnswerError);

const notPending = {
  status: 404 as const,
  code: "NOT_PENDING" as const,
  message: "No question is waiting under that id.",
};

export const answerQuestion = (
  conversationId: string,
  toolUseId: string,
  answers: AskUserQuestionAnswers,
): Result<void, AnswerQuestionError> => {
  const pending = getPendingQuestion(conversationId, toolUseId);
  if (!pending) return err(notPending);

  const built = buildAnswer(pending.input, answers);
  if (built.isErr()) return err({ status: 400, ...built.error });

  // Only false if the question settled between the lookup and here, and
  // nothing in between yields — but the store is the one that knows.
  const settled = settleQuestion(conversationId, toolUseId, {
    behavior: "allow",
    updatedInput: built.value,
  });
  return settled ? ok(undefined) : err(notPending);
};

export const declineQuestion = (
  conversationId: string,
  toolUseId: string,
): boolean =>
  settleQuestion(conversationId, toolUseId, {
    behavior: "deny",
    message: DENY_MESSAGES.declined,
  });

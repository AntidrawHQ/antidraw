import { memo, useState } from "react";
import { cn } from "@/renderer/lib/utils";
import type { ToolPart } from "@/renderer/components/ui/tool";
import { Ring, Tool } from "@/renderer/components/ui/tool";
import {
  answersFromToolUseResult,
  parseAskUserQuestionInput,
  type AskUserQuestionAnswers,
  type AskUserQuestionInput,
  type AskUserQuestionItem,
} from "@/shared/utils/ask-user-question";
import {
  useAnswerQuestion,
  useDeclineQuestion,
  usePendingQuestionIds,
} from "@/renderer/lib/claude-code-ops";

// One question's selection. `selected` holds option labels; `other` is the
// typed answer, counted only while `otherOn`.
type Choice = { selected: string[]; otherOn: boolean; other: string };
const EMPTY_CHOICE: Choice = { selected: [], otherOn: false, other: "" };

// The answer a choice amounts to, or null while it amounts to none. Options
// keep the question's order, so the same picks always send the same answer.
const answerFor = (q: AskUserQuestionItem, c: Choice): string | string[] | null => {
  const other = c.otherOn ? c.other.trim() : "";
  if (!q.multiSelect) {
    if (c.otherOn) return other || null;
    return c.selected[0] ?? null;
  }
  const picked = q.options.map((o) => o.label).filter((l) => c.selected.includes(l));
  const all = other ? [...picked, other] : picked;
  return all.length ? all : null;
};

const toggle = (q: AskUserQuestionItem, c: Choice, label: string): Choice => {
  if (!q.multiSelect) return { ...c, selected: [label], otherOn: false };
  return c.selected.includes(label)
    ? { ...c, selected: c.selected.filter((l) => l !== label) }
    : { ...c, selected: [...c.selected, label] };
};

const toggleOther = (q: AskUserQuestionItem, c: Choice): Choice =>
  q.multiSelect ? { ...c, otherOn: !c.otherOn } : { ...c, selected: [], otherOn: true };

// The row's ring (see Ring in ui/tool), holding a question mark: settled
// tools get a check or ×, a question waiting on the user gets this.
const AskingIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".55" />
    <path d="M9.75 9.75a2.25 2.25 0 1 1 3.2 2.04c-.6.28-.95.8-.95 1.46v.25" />
    <path d="M12 16.25h.01" />
  </svg>
);

export type AskUserQuestionCardProps = {
  input: AskUserQuestionInput;
  state: ToolPart["state"];
  // The CLI is blocked on this question right now — the only state in which
  // it can be answered.
  pending: boolean;
  // What the tool ran with, once it has (from its structured output).
  answered: Record<string, string> | null;
  errorText?: string;
  busy?: boolean;
  onSubmit: (answers: AskUserQuestionAnswers) => void;
  onDecline: () => void;
  className?: string;
};

export const AskUserQuestionCard = ({
  input,
  state,
  pending,
  answered,
  errorText,
  busy = false,
  onSubmit,
  onDecline,
  className,
}: AskUserQuestionCardProps) => {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const choiceOf = (q: AskUserQuestionItem) => choices[q.question] ?? EMPTY_CHOICE;
  const setChoice = (q: AskUserQuestionItem, next: Choice) =>
    setChoices((prev) => ({ ...prev, [q.question]: next }));

  const answers = input.questions.map((q) => [q.question, answerFor(q, choiceOf(q))] as const);
  const complete = answers.every(([, a]) => a !== null);
  const interactive = pending && !busy;

  const status = answered
    ? { icon: <Ring failed={false} />, text: "Answered" }
    : state === "output-error"
      ? { icon: <Ring failed />, text: "Not answered" }
      : pending
        ? { icon: <AskingIcon />, text: "Claude is asking" }
        : { icon: <AskingIcon />, text: "Question" };

  return (
    <div
      data-testid="ask-user-question"
      className={cn(
        // The tool group's card and hairlines, a step brighter while it
        // waits — the one thing in the transcript that needs the user.
        "overflow-hidden rounded-md border",
        pending ? "border-white/[0.16]" : "border-white/[0.05]",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="grid w-4 shrink-0 place-items-center text-neutral-500">
          {status.icon}
        </span>
        <p className="m-0 text-[13px] text-neutral-300">{status.text}</p>
      </div>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] px-2.5 py-2.5">
        {input.questions.map((q) => {
          const choice = choiceOf(q);
          const final = answered?.[q.question];
          const preview = !q.multiSelect
            ? q.options.find((o) => o.label === choice.selected[0])?.preview
            : undefined;
          return (
            <div key={q.question} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                {q.header && (
                  <span className="shrink-0 rounded-sm bg-white/[0.06] px-1.5 py-px text-[11px] text-neutral-400">
                    {q.header}
                  </span>
                )}
                <p className="m-0 text-[13px] text-neutral-100">{q.question}</p>
              </div>

              {answered ? (
                <p className="m-0 text-[13px] text-neutral-400" data-testid="answer">
                  {final ?? "—"}
                </p>
              ) : (
                <div
                  role={q.multiSelect ? "group" : "radiogroup"}
                  aria-label={q.question}
                  className="flex flex-col gap-1"
                >
                  {q.options.map((o) => {
                    const on = choice.selected.includes(o.label);
                    return (
                      <button
                        key={o.label}
                        type="button"
                        role={q.multiSelect ? "checkbox" : "radio"}
                        aria-checked={on}
                        disabled={!interactive}
                        onClick={() => setChoice(q, toggle(q, choice, o.label))}
                        className={cn(
                          "flex cursor-pointer flex-col items-start rounded-md border px-2.5 py-1.5 text-left disabled:cursor-default",
                          on
                            ? "border-white/[0.22] bg-white/[0.06]"
                            : "border-white/[0.06] enabled:hover:bg-white/[0.025]",
                        )}
                      >
                        <span className={cn("text-[13px]", on ? "text-neutral-100" : "text-neutral-300")}>
                          {o.label}
                        </span>
                        {o.description && (
                          <span className="text-[12px] text-neutral-500">{o.description}</span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role={q.multiSelect ? "checkbox" : "radio"}
                    aria-checked={choice.otherOn}
                    disabled={!interactive}
                    onClick={() => setChoice(q, toggleOther(q, choice))}
                    className={cn(
                      "rounded-md border border-dashed px-2.5 py-1.5 text-left text-[13px] disabled:cursor-default",
                      choice.otherOn
                        ? "border-white/[0.22] text-neutral-100"
                        : "border-white/[0.08] text-neutral-500 enabled:hover:bg-white/[0.025]",
                    )}
                  >
                    Other…
                  </button>
                  {choice.otherOn && (
                    <input
                      type="text"
                      aria-label={`Other answer: ${q.question}`}
                      autoFocus
                      disabled={!interactive}
                      value={choice.other}
                      onChange={(e) => setChoice(q, { ...choice, other: e.target.value })}
                      placeholder="Type your answer"
                      className="rounded-md border border-white/[0.08] bg-transparent px-2.5 py-1.5 text-[13px] text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/[0.22]"
                    />
                  )}
                  {preview && (
                    <pre className="m-0 overflow-x-auto rounded-md bg-white/[0.03] p-2 font-mono text-[11px] leading-[1.6] text-neutral-300">
                      {preview}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {state === "output-error" && errorText && (
          <p className="m-0 text-[12px] text-red-300/70" data-testid="error">
            {errorText}
          </p>
        )}

        {pending && (
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="rounded-md px-2.5 py-1 text-[13px] text-neutral-500 hover:text-neutral-200 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              disabled={!complete || busy}
              onClick={() =>
                onSubmit(Object.fromEntries(answers) as AskUserQuestionAnswers)
              }
              className="rounded-md bg-neutral-100 px-2.5 py-1 text-[13px] font-medium text-neutral-900 hover:bg-white disabled:opacity-30"
            >
              Submit
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// The card, wired to the conversation: whether the CLI is waiting on this
// question comes from the backend's `questions` mirror, keyed by the tool_use
// id. An input that does not parse falls back to the generic tool row rather
// than drawing a card it cannot answer.
export const AskUserQuestion = memo(function AskUserQuestion({
  conversationId,
  toolUseId,
  toolPart,
  className,
}: {
  conversationId: string;
  toolUseId: string;
  toolPart: ToolPart;
  className?: string;
}) {
  const { data: pendingIds } = usePendingQuestionIds(conversationId);
  const answer = useAnswerQuestion();
  const decline = useDeclineQuestion();
  const input = parseAskUserQuestionInput(toolPart.input);

  if (!input) {
    return (
      <Tool
        toolPart={toolPart}
        className={cn("overflow-hidden rounded-md border border-white/[0.05]", className)}
      />
    );
  }

  return (
    <AskUserQuestionCard
      input={input}
      state={toolPart.state}
      pending={pendingIds.includes(toolUseId)}
      answered={answersFromToolUseResult(toolPart.structuredOutput)}
      errorText={toolPart.errorText}
      busy={answer.isPending || decline.isPending}
      onSubmit={(answers) => answer.mutate({ conversationId, toolUseId, answers })}
      onDecline={() => decline.mutate({ conversationId, toolUseId })}
      className={className}
    />
  );
});

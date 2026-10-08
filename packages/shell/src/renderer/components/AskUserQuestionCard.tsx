import { BorderBeam } from "border-beam";
import { ArrowRight, ArrowUp, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/renderer/lib/utils";
import type { ToolPart } from "@/renderer/components/ui/tool";
import { Tool } from "@/renderer/components/ui/tool";
import {
  DENY_MESSAGES,
  answersFromToolUseResult,
  parseAskUserQuestionInput,
  splitMultiSelect,
  type AskUserQuestionAnswers,
  type AskUserQuestionInput,
  type AskUserQuestionItem,
} from "@/shared/utils/ask-user-question";
import {
  conversationQueryOpts,
  useAnswerQuestion,
  useDeclineQuestion,
  usePendingQuestionIds,
} from "@/renderer/lib/claude-code-ops";

/* ── Model ─────────────────────────────────────────────────────────────── */

// One question's selection. `selected` holds option labels; `other` is the
// typed answer, counted only while `otherOn`.
type Choice = { selected: string[]; otherOn: boolean; other: string };
const EMPTY: Choice = { selected: [], otherOn: false, other: "" };

// Before the CLI parks it: still streaming in, or arrived but not yet
// answerable. Open: waiting on the user, or sending. Then how it settled;
// "rejected" is an error none of the others account for.
type Phase =
  | "arriving"
  | "ready"
  | "waiting"
  | "busy"
  | "answered"
  | "skipped"
  | "stopped"
  | "ended"
  | "notShown"
  | "rejected";
const OPEN: Phase[] = ["waiting", "busy"];

const RECO = /\s*\(Recommended\)\s*$/;
const bare = (l: string) => l.replace(RECO, "");

// The answer a choice amounts to, or null while it amounts to none. Options
// keep the question's order, so the same picks always send the same answer.
const answerFor = (q: AskUserQuestionItem, c: Choice): string[] | null => {
  const other = c.otherOn ? c.other.trim() : "";
  if (!q.multiSelect) return c.otherOn ? (other ? [other] : null) : c.selected.length ? [c.selected[0]!] : null;
  const all = [...q.options.map((o) => o.label).filter((l) => c.selected.includes(l)), ...(other ? [other] : [])];
  return all.length ? all : null;
};

// Single-select: a pick replaces the last and unpicks Other (its text stays).
// Multi-select: picks toggle.
const pick = (q: AskUserQuestionItem, c: Choice, label: string): Choice =>
  !q.multiSelect
    ? { ...c, selected: [label], otherOn: false }
    : c.selected.includes(label)
      ? { ...c, selected: c.selected.filter((l) => l !== label) }
      : { ...c, selected: [...c.selected, label] };

// Other is picked while it holds text; on single-select that clears the pick.
const typeOther = (q: AskUserQuestionItem, c: Choice, other: string): Choice => {
  const on = other.trim() !== "";
  return q.multiSelect ? { ...c, other, otherOn: on } : { ...c, other, otherOn: on, selected: on ? [] : c.selected };
};

// Clicking into Other re-picks the text it still holds. Only a click: tabbing
// through it on the way to send must not swap the pick for that text.
const clickOther = (q: AskUserQuestionItem, c: Choice): Choice =>
  !q.multiSelect && !c.otherOn && c.other.trim() ? { ...c, otherOn: true, selected: [] } : c;

// What the CLI itself writes for a tool call cut short by Stop. It cancels the
// permission request and persists its own rejection, so the cancelled deny we
// answer with never reaches the tool_result.
const INTERRUPTED = [
  "The user doesn't want to proceed with this tool use",
  "[Request interrupted by user",
  "Tool permission request aborted",
];

// Which deny settled it, from the tool_result the model read.
const deniedAs = (errorText = ""): Phase => {
  const has = (s: string) => errorText.includes(s);
  return has(DENY_MESSAGES.declined)
    ? "skipped"
    : has(DENY_MESSAGES.cancelled) || INTERRUPTED.some(has)
      ? "stopped"
      : has(DENY_MESSAGES.noHandle) || has(DENY_MESSAGES.unreadable)
        ? "notShown"
        : has(DENY_MESSAGES.ended)
          ? "ended"
          : "rejected";
};

/* ── Look ──────────────────────────────────────────────────────────────── */

const BOX = "relative flex flex-col gap-0.5 rounded-md border border-white/[0.05] p-1.5 outline-none";
const CHIP = "shrink-0 rounded-sm bg-white/[0.06] px-1.5 py-px text-[11px] text-neutral-400";

const Beam = ({ active, children }: { active: boolean; children: ReactNode }) => (
  <BorderBeam
    size="sm"
    colorVariant="mono"
    theme="dark"
    borderRadius={6}
    duration={3}
    strength={1}
    glowSize={0.7}
    brightness={1.6}
    saturation={3}
    hueRange={10}
    active={active}
    style={{ "--beam-hue-base": "19deg" } as CSSProperties}
  >
    {children}
  </BorderBeam>
);

const Spinner = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className="animate-spin">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const Box = ({ on }: { on: boolean }) => (
  <span
    className={cn(
      "grid size-3.5 shrink-0 place-items-center self-center rounded-[3px] border",
      on ? "border-neutral-100 bg-neutral-100 text-neutral-900" : "border-neutral-500",
    )}
  >
    {on && <Check className="size-2.5" strokeWidth={3} />}
  </span>
);

const Caret = () => <span className="ml-px inline-block h-[13px] w-[6px] translate-y-[2px] animate-pulse bg-neutral-400" />;

/* ── Open card: arriving, ready, waiting, busy ─────────────────────────── */

type OpenProps = {
  qs: AskUserQuestionItem[];
  phase: Phase;
  choices: Record<string, Choice>;
  setChoice: (q: AskUserQuestionItem, c: Choice) => void;
  step: number;
  setStep: (i: number) => void;
  submitError?: string;
  onSubmit: () => void;
  onSkip: () => void;
  className?: string;
};

const OpenCard = ({ qs, phase, choices, setChoice, step, setStep, submitError, onSubmit, onSkip, className }: OpenProps) => {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const q = qs[step]!;
  const c = choices[q.question] ?? EMPTY;
  const many = qs.length > 1;
  const last = step === qs.length - 1;
  const interactive = phase === "waiting";
  const done = (x: AskUserQuestionItem) => answerFor(x, choices[x.question] ?? EMPTY) !== null;
  const canGo = last ? qs.every(done) : done(q);

  // Focus goes to the card on every move: the focused option unmounts with
  // its question, and a focused Other input would take the next question's
  // 1–9 as text.
  const moveTo = (i: number) => {
    setStep(i);
    box.current?.focus({ preventScroll: true });
  };
  const go = () => {
    if (!interactive || !canGo) return;
    if (last) onSubmit();
    else moveTo(step + 1);
  };
  // A pick stays on its question; moving on is the user's, by → or ↵.
  const choose = (label: string) => setChoice(q, pick(q, c, label));

  const onKey = (e: KeyboardEvent) => {
    // Enter or Esc mid-composition commits or cancels the IME's text.
    if (!interactive || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT";
    // A focused tab, Skip or send button does its own thing on Enter; from an
    // option, the Other input or the card, Enter is next / send.
    const role = target.getAttribute("role");
    const ownButton = target.tagName === "BUTTON" && role !== "radio" && role !== "checkbox";
    if (e.key === "Escape") onSkip();
    else if (e.key === "Enter" && !ownButton) {
      e.preventDefault();
      go();
    } else if (!typing && /^[1-9]$/.test(e.key) && +e.key <= q.options.length) choose(q.options[+e.key - 1]!.label);
    else if (!typing && many && e.key === "ArrowRight") moveTo(Math.min(step + 1, qs.length - 1));
    else if (!typing && many && e.key === "ArrowLeft") moveTo(Math.max(step - 1, 0));
  };

  const shownIdx = hover ?? q.options.findIndex((o) => c.selected.includes(o.label));
  const preview = !q.multiSelect && shownIdx >= 0 ? q.options[shownIdx]?.preview : undefined;
  const status =
    phase === "arriving" ? (
      <span className="auq-working">Claude is asking…</span>
    ) : phase === "ready" ? (
      "Question"
    ) : phase === "busy" ? (
      "Sending…"
    ) : (
      "Claude is waiting on this"
    );

  return (
    <div ref={box} data-testid="ask-user-question" tabIndex={interactive ? 0 : -1} onKeyDown={onKey} className={cn(BOX, className)}>
      <div className="flex flex-col gap-1.5 px-1.5 pb-1 pt-1.5">
        <div className="flex min-h-[18px] items-center gap-2">
          {many ? (
            // Several questions: the headers are tabs, each ticked once answered.
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {qs.map((x, i) => (
                <button
                  key={x.question}
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  disabled={!interactive}
                  onClick={() => moveTo(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px text-[11px] disabled:cursor-default",
                    i === step ? "bg-white/[0.1] text-neutral-100" : done(x) ? "text-neutral-400 hover:text-neutral-200" : "text-neutral-500 hover:text-neutral-300",
                  )}
                >
                  {done(x) && i !== step && <Check className="size-3" />}
                  {x.header || `Question ${i + 1}`}
                </button>
              ))}
              <span className="ml-1 text-[11px] text-neutral-600">
                {step + 1} of {qs.length}
              </span>
            </div>
          ) : (
            <>
              {q.header && <span className={CHIP}>{q.header}</span>}
              <span className="flex-1 text-[12px] text-neutral-500">{status}</span>
            </>
          )}
          {OPEN.includes(phase) && (
            <button type="button" disabled={phase === "busy"} onClick={onSkip} className="cursor-pointer text-[12px] text-neutral-500 hover:text-neutral-200 disabled:cursor-default disabled:opacity-50">
              Skip
            </button>
          )}
        </div>
        <p className="m-0 text-[13px] text-neutral-100">
          {q.question}
          {phase === "arriving" && q.options.length === 0 && <Caret />}
          {q.multiSelect && phase !== "arriving" && <span className="ml-1.5 text-[12px] text-neutral-500">Choose any</span>}
        </p>
      </div>

      {q.options.map((o, i) => {
        const on = c.selected.includes(o.label);
        const reco = RECO.test(o.label);
        return (
          <button
            key={o.label}
            type="button"
            role={q.multiSelect ? "checkbox" : "radio"}
            aria-checked={on}
            title={o.description}
            disabled={!interactive}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => choose(o.label)}
            className={cn(
              "group flex cursor-pointer items-baseline gap-2 rounded px-1.5 py-1.5 text-left disabled:cursor-default",
              on ? "bg-white/[0.06]" : "enabled:hover:bg-white/[0.03]",
            )}
          >
            {q.multiSelect && <Box on={on} />}
            <span className={cn("shrink-0 text-[13px]", on ? "text-neutral-100" : "text-neutral-300")}>{bare(o.label)}</span>
            {reco && <span className="shrink-0 self-center rounded-sm bg-white/[0.07] px-1 py-px text-[10.5px] leading-none text-neutral-400">Recommended</span>}
            <span className="min-w-0 truncate text-[12px] text-neutral-500">
              {o.description}
              {phase === "arriving" && i === q.options.length - 1 && <Caret />}
            </span>
            {interactive && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-neutral-600 opacity-0 group-hover:opacity-100">{i + 1}</span>}
          </button>
        );
      })}

      {preview && (
        <pre className="mx-1.5 my-1 overflow-x-auto rounded bg-black/25 p-2 font-mono text-[11px] leading-[1.6] text-neutral-300">{preview}</pre>
      )}

      {phase !== "arriving" && (
        <div className={cn("mt-0.5 flex items-center gap-1.5 rounded py-1 pl-1.5 pr-1", c.otherOn ? "bg-white/[0.06]" : "focus-within:bg-white/[0.03]")}>
          {q.multiSelect && <Box on={c.otherOn} />}
          <input
            aria-label={`Other answer: ${q.question}`}
            value={c.other}
            disabled={!interactive}
            onClick={() => setChoice(q, clickOther(q, c))}
            onChange={(e) => setChoice(q, typeOther(q, c, e.target.value))}
            placeholder={q.multiSelect ? "Add your own…" : "Or type your own answer…"}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-100 outline-none placeholder:text-neutral-500 disabled:cursor-default"
          />
          {OPEN.includes(phase) && (
            <button
              type="button"
              disabled={!interactive || !canGo}
              onClick={go}
              title={last ? "Send answers" : "Next question"}
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full bg-neutral-100 text-neutral-900 disabled:cursor-default disabled:opacity-20"
            >
              {phase === "busy" ? <Spinner /> : last ? <ArrowUp className="size-3.5" /> : <ArrowRight className="size-3.5" />}
            </button>
          )}
        </div>
      )}

      {phase === "waiting" && submitError && (
        <p className="m-0 px-1.5 pb-1 pt-0.5 text-[12px] text-red-300/70" data-testid="submit-error">
          {submitError}
        </p>
      )}
    </div>
  );
};

/* ── Settled card ──────────────────────────────────────────────────────── */

const REASON: Partial<Record<Phase, string>> = {
  skipped: "Skipped — Claude carried on without it.",
  stopped: "Stopped before it was answered.",
  ended: "The session ended before it was answered.",
  notShown: "Couldn't be shown — Claude asked in plain text instead.",
};

const STATUS: Partial<Record<Phase, string>> = {
  answered: "Answered",
  skipped: "Skipped",
  stopped: "Not answered",
  ended: "Not answered",
  notShown: "Not shown",
  rejected: "Not answered",
};

const SettledRow = ({ on, label, description }: { on: boolean; label: string; description?: string }) => (
  <div className={cn("flex items-baseline gap-2 rounded px-1.5 py-1.5", on && "bg-white/[0.06]")}>
    <span className={cn("shrink-0 text-[13px]", on ? "text-neutral-100" : "text-neutral-500")}>{label}</span>
    {description && <span className={cn("min-w-0 truncate text-[12px]", on ? "text-neutral-500" : "text-neutral-600")}>{description}</span>}
    {on && <Check className="ml-auto size-3.5 shrink-0 self-center text-neutral-300" />}
  </div>
);

const SettledCard = ({
  qs,
  phase,
  answers,
  errorText,
  className,
}: {
  qs: AskUserQuestionItem[];
  phase: Phase;
  answers: Record<string, string[]> | null;
  errorText?: string;
  className?: string;
}) => {
  const q = qs[0]!;
  const many = qs.length > 1;
  // An error we have no words for says it in its own.
  const reason = phase === "rejected" ? errorText : REASON[phase];
  return (
    <div data-testid="ask-user-question" className={cn(BOX, className)}>
      <div className="flex flex-col gap-1.5 px-1.5 pb-1 pt-1.5">
        <div className="flex min-h-[18px] items-center gap-2">
          {!many && q.header && <span className={CHIP}>{q.header}</span>}
          <span className="flex-1 text-[12px] text-neutral-500">
            {STATUS[phase]}
            {many && ` · ${qs.length} questions`}
          </span>
        </div>
        {!many && <p className="m-0 text-[13px] text-neutral-100">{q.question}</p>}
      </div>

      {many
        ? // Several questions: each as its question over its answer.
          qs.map((x) => {
            const a = answers?.[x.question];
            return (
              <div key={x.question} className="flex flex-col gap-0.5 px-1.5 py-1.5">
                <span className="truncate text-[12px] text-neutral-500">{x.question}</span>
                <span className={cn("flex items-center gap-1.5 text-[13px]", a ? "text-neutral-100" : "text-neutral-600")}>
                  {a ? (
                    <>
                      <Check className="size-3.5 shrink-0 text-neutral-400" />
                      {a.map(bare).join(", ")}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            );
          })
        : (() => {
            const a = answers?.[q.question] ?? [];
            const typed = a.filter((x) => !q.options.some((o) => o.label === x));
            return (
              <>
                {q.options.map((o) => (
                  <SettledRow key={o.label} on={a.includes(o.label)} label={bare(o.label)} description={o.description} />
                ))}
                {typed.map((t) => (
                  <SettledRow key={t} on label={`“${t}”`} />
                ))}
              </>
            );
          })()}

      {reason && <p className={cn("m-0 px-1.5 pb-1 pt-1 text-[12px]", phase === "skipped" ? "text-neutral-500" : "text-red-300/70")}>{reason}</p>}
    </div>
  );
};

/* ── The card ──────────────────────────────────────────────────────────── */

export type AskUserQuestionCardProps = {
  input: AskUserQuestionInput;
  state: ToolPart["state"];
  // The CLI is blocked on this question right now — the only state in which
  // it can be answered.
  pending: boolean;
  // What the tool ran with, once it has (from its structured output).
  answered: Record<string, string> | null;
  // The deny the model read, for a question that settled without an answer.
  errorText?: string;
  // Why the last Submit or Skip did not go through. The question is still
  // waiting, so the card stays answerable and says what went wrong.
  submitError?: string;
  busy?: boolean;
  // The turn is over (idle, or its stream failed). A question it was waiting
  // on that has no result by now will not get one: the CLI is gone.
  turnEnded?: boolean;
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
  submitError,
  busy = false,
  turnEnded = false,
  onSubmit,
  onDecline,
  className,
}: AskUserQuestionCardProps) => {
  const qs = input.questions;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [step, setStep] = useState(0);
  // Once it has waited, a question no longer pending but not yet settled has
  // been answered or skipped and is on its way: it stays "Sending…" until its
  // result lands, rather than going back to looking unasked — or until the
  // turn ends without one.
  const [asked, setAsked] = useState(pending);
  if (pending && !asked) setAsked(true);

  const phase: Phase = answered
    ? "answered"
    : state === "output-error"
      ? deniedAs(errorText)
      : pending
        ? busy
          ? "busy"
          : "waiting"
        : asked
          ? turnEnded
            ? "ended"
            : "busy"
          : state === "input-streaming"
            ? "arriving"
            : "ready";

  if (!OPEN.includes(phase) && phase !== "arriving" && phase !== "ready") {
    const answers = answered
      ? Object.fromEntries(
          qs.map((q) => {
            const a = answered[q.question];
            return [q.question, a === undefined ? [] : q.multiSelect ? splitMultiSelect(a) : [a]];
          }),
        )
      : null;
    return <SettledCard qs={qs} phase={phase} answers={answers} errorText={errorText} className={className} />;
  }

  const body = (
    <OpenCard
      qs={qs}
      phase={phase}
      choices={choices}
      setChoice={(q, c) => setChoices((prev) => ({ ...prev, [q.question]: c }))}
      step={Math.min(step, qs.length - 1)}
      setStep={setStep}
      submitError={submitError}
      onSubmit={() =>
        onSubmit(
          Object.fromEntries(
            qs.map((q) => {
              const a = answerFor(q, choices[q.question] ?? EMPTY) ?? [];
              return [q.question, q.multiSelect ? a : a[0]];
            }),
          ) as AskUserQuestionAnswers,
        )
      }
      onSkip={onDecline}
      className={className}
    />
  );
  return OPEN.includes(phase) ? <Beam active={pending}>{body}</Beam> : body;
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
  // Read from the conversation the chat already holds, never fetched here.
  const { data: streamStatus } = useQuery({
    ...conversationQueryOpts(conversationId),
    enabled: false,
    select: (c) => c.streamStatus,
  });
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
      // At most one is set: each action resets the other's error first.
      submitError={(answer.error ?? decline.error)?.message}
      busy={answer.isPending || decline.isPending}
      turnEnded={streamStatus !== undefined && streamStatus !== "streaming"}
      onSubmit={(answers) => {
        decline.reset();
        answer.mutate({ conversationId, toolUseId, answers });
      }}
      onDecline={() => {
        answer.reset();
        decline.mutate({ conversationId, toolUseId });
      }}
      className={className}
    />
  );
});

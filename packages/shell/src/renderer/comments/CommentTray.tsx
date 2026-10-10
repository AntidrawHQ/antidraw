import { useState } from "react";
import { ArrowUp, ArrowUpRight, ChevronDown, CornerDownRight, Pencil, X } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { Ring } from "@/renderer/components/ui/tool";
import { Beam } from "@/renderer/components/AskUserQuestionCard";
import { FLOAT, floatShadow, Pending, TextBtn } from "./pieces";
import { allDone, count, isActive, LABEL, type Actions, type Cmt, type Flow, type Phase, type Send } from "./model";

// The comments list (design: CommentFlow's Tray): what hasn't gone out yet,
// and every set that has, each under its chat. Drawn over the canvas by
// CommentFlow.

// A not-sent comment: its number and text. Click opens it on the canvas;
// on hover, the pencil opens it for editing and × drops it.
const DraftRow = ({ i, c, a }: { i: number; c: Cmt; a: Actions }) => (
  <div
    onClick={() => a.open(c.id)}
    onMouseEnter={() => a.point(c.id)}
    onMouseLeave={() => a.point(null)}
    className={cn("group flex cursor-pointer items-baseline gap-2 rounded px-1.5 py-1.5", a.opened === c.id ? "bg-white/[0.07]" : "hover:bg-white/[0.03]")}
  >
    <span className="grid w-4 shrink-0 place-items-center font-mono text-[10.5px] text-neutral-500">{i}</span>
    <span className="min-w-0 flex-1 break-words text-[13px] leading-[18px] text-neutral-100">{c.text}</span>
    <span className={cn("flex shrink-0 items-center gap-0.5 self-center", a.opened === c.id ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
      <button
        type="button"
        aria-label="Edit comment"
        title="Edit"
        onClick={(e) => {
          e.stopPropagation();
          a.open(c.id, true);
        }}
        className="grid size-5 cursor-pointer place-items-center rounded text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        aria-label="Remove comment"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          a.remove(c.id);
        }}
        className="grid size-5 cursor-pointer place-items-center rounded text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"
      >
        <X className="size-3" />
      </button>
    </span>
  </div>
);

// A comment in a set. Claude's note goes to the next chat's history, not
// here. One still Sent after its chat ended gets × on hover; otherwise it
// waits for Claude, from the chat.
const SentRow = ({ c, n, phase, a }: { c: Cmt; n: number; phase: Phase; a: Actions }) => (
  <div
    onClick={() => a.open(c.id)}
    onMouseEnter={() => a.point(c.id)}
    onMouseLeave={() => a.point(null)}
    className={cn("group flex cursor-pointer gap-2 rounded px-1.5 py-1.5", a.opened === c.id ? "bg-white/[0.07]" : "hover:bg-white/[0.03]")}
  >
    <span className="grid w-4 shrink-0 place-items-start pt-px text-neutral-500">{c.state === "done" ? <Ring failed={false} /> : <Pending />}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className={cn("min-w-0 flex-1 break-words text-[13px] leading-[18px]", c.state === "done" ? "text-neutral-400" : "text-neutral-200")}>{c.text}</span>
        <span className={cn("shrink-0 text-[11px]", c.state === "done" ? "text-neutral-500" : "text-neutral-400")}>{LABEL[c.state]}</span>
        {phase === "ended" && c.state === "sent" && (
          <button
            type="button"
            aria-label="Remove comment"
            onClick={(e) => {
              e.stopPropagation();
              a.dismiss(n, c.id);
            }}
            className="grid size-4 shrink-0 cursor-pointer place-items-center self-center rounded-sm text-neutral-500 opacity-0 hover:text-neutral-200 group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  </div>
);

// What sits before "Chat N" on a set's header.
const chatIcon = <CornerDownRight className="size-3.5" strokeWidth={1.75} />;

// One set: its chat, where it's got to, and its comments. Open while there's
// anything to watch or act on; folds once every comment is completed.
const SendGroup = ({ s, a }: { s: Send; a: Actions }) => {
  const complete = allDone(s);
  const [pin, setPin] = useState<boolean | null>(null);
  const open = pin ?? !complete;
  // No completed count: each row shows its own. Only what the rows can't say.
  // A send resumes the chat it goes to, or starts it: either way it opens.
  const label = s.phase === "opening" ? "Opening chat…" : null;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-white/[0.03]">
        <button type="button" onClick={() => setPin(!open)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          <span className="grid w-4 shrink-0 place-items-center text-neutral-400">{chatIcon}</span>
          <span className="shrink-0 text-[12.5px] font-medium text-neutral-200">Chat {s.n}</span>
          {label && <span className={cn("min-w-0 truncate text-[12px]", isActive(s) ? "auq-shimmer" : "text-neutral-500")}>{label}</span>}
          <ChevronDown className={cn("size-3.5 shrink-0 text-neutral-500 transition-transform", !open && "-rotate-90")} />
        </button>
        <TextBtn onClick={() => a.chat(s.conversationId)} className="flex shrink-0 items-center gap-1 font-medium text-neutral-400">
          <ArrowUpRight className="size-3.5" />
          Open
        </TextBtn>
      </div>
      {open && (
        <div className="flex flex-col pl-6">
          {s.comments.map((c) => (
            <SentRow key={c.id} c={c} n={s.n} phase={s.phase} a={a} />
          ))}
        </div>
      )}
    </div>
  );
};

// The list, at the canvas's top right, whatever the tool. Hidden until
// there's something in it. Never wider than the canvas leaves room for.
export const TRAY_W = 392;
export const Tray = ({ f, a, sending }: { f: Flow; a: Actions; sending: boolean }) => {
  if (!f.draft.length && !f.sends.length) return null;
  const hasDone = f.sends.some((s) => s.phase === "ended" && count(s, "done") > 0);
  return (
    <div data-comment-ui onClick={(e) => e.stopPropagation()} className="pointer-events-auto absolute right-4 top-4 z-30 w-[392px] max-w-[calc(100%-32px)]">
      <Beam active={f.sends.some((s) => s.phase === "opening")} radius={12}>
        <div className={cn("flex flex-col gap-0.5 p-1.5", FLOAT)} style={floatShadow}>
          <div className="flex min-h-[20px] items-center gap-2 px-1.5 pb-1 pt-1.5">
            <span className="text-[13px] font-medium text-neutral-100">Comments</span>
          </div>
          <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
            {f.sends.map((s) => (
              <SendGroup key={s.n} s={s} a={a} />
            ))}
            {/* Under the chats, a heading for what hasn't gone out. */}
            {f.sends.length > 0 && f.draft.length > 0 && <p className="m-0 px-1.5 pb-0.5 pt-2.5 text-[12px] text-neutral-500">Not sent yet</p>}
            {f.draft.map((c, i) => (
              <DraftRow key={c.id} i={i + 1} c={c} a={a} />
            ))}
          </div>
          {(f.draft.length > 0 || hasDone) && (
            <div className="flex items-center gap-2 px-1 pb-0.5 pt-1.5">
              {hasDone && (
                <button type="button" onClick={a.clearDone} className="flex h-[26px] cursor-pointer items-center rounded-md px-2 text-[13px] text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-neutral-50">
                  Clear completed
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                disabled={!f.draft.length || sending}
                onClick={a.send}
                className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#e0e0e0] px-2.5 text-[13px] font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-default disabled:opacity-25"
              >
                Send to chat
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </Beam>
    </div>
  );
};

import { ArrowUp, Pencil, X } from "lucide-react";
import type { EffortLevel } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { Ring } from "@/renderer/components/ui/tool";
import { Beam } from "@/renderer/components/AskUserQuestionCard";
import { useCommentsChanged } from "@/renderer/lib/comment-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { FLOAT, floatShadow, Pending } from "./pieces";
import { count, LABEL, type Actions, type Cmt, type Phase } from "./model";
import { useCommentActions } from "./use-comment-actions";

// The comments list, in the chat panel above the composer: what hasn't gone
// out yet, and the open chat's own comments with where they've got to. Send
// sends the drafts into this chat (or a new one, with none open). Other
// chats' comments are in those chats. Hidden until there's something in it.

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

// A comment this chat was sent. Claude's note goes to later chats' history,
// not here. One still Sent after the chat's turn ended gets × on hover;
// otherwise it waits for Claude.
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

export const ChatComments = ({ model, effort }: { model?: string; effort?: EffortLevel }) => {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const conversationId = useWorkspaceStore((s) => s.activeConversationId);
  useCommentsChanged(workspaceId);
  const { f, a, sending } = useCommentActions({ model, effort });

  // This chat's sets: one per send into it, oldest first.
  const own = f.sends.filter((s) => s.conversationId === conversationId);
  const sent = own.flatMap((s) => s.comments.map((c) => ({ c, s })));
  if (!f.draft.length && !sent.length) return null;
  const hasDone = own.some((s) => s.phase === "ended" && count(s, "done") > 0);

  return (
    <div className="px-4 pt-2">
      {/* Near square, in the chat panel; the canvas's box and card stay round. */}
      <Beam active={own.some((s) => s.phase === "opening")} radius={4}>
        <div className={cn("flex flex-col gap-0.5 p-1.5", FLOAT, "rounded-[4px]")} style={floatShadow}>
          <div className="flex min-h-[20px] items-center gap-2 px-1.5 pb-1 pt-1.5">
            <span className="text-[13px] font-medium text-neutral-100">Comments</span>
          </div>
          <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
            {sent.map(({ c, s }) => (
              <SentRow key={c.id} c={c} n={s.n} phase={s.phase} a={a} />
            ))}
            {/* Under what's gone out, a heading for what hasn't. */}
            {sent.length > 0 && f.draft.length > 0 && <p className="m-0 px-1.5 pb-0.5 pt-2.5 text-[12px] text-neutral-500">Not sent yet</p>}
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

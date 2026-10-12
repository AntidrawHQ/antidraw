/**
 * The right panel's Comments section, as real comment panels show them
 * (Framer, Dropbox Dash, Air, Zoom's whiteboard): a card per comment, who
 * and when, the text, where it is; the agent's note threaded under it as its
 * reply; Open · Resolved at the top (Magnific, Obvious). antidraw doesn't
 * know who wrote a comment, so the author is "You", with an avatar from the
 * workspace switcher's set (boring-avatars, its palette; a different
 * variant). At the bottom, by Send, as a composer holds a draft: the
 * comments written and not sent.
 *
 * Each comment gets one status, said once:
 *   draft     its pin, numbered as on the canvas (not sent yet)
 *   working   its chat is running. antidraw can't say which comment Claude
 *             is on, only that its chat is running: the spinner is the
 *             chat's, never a comment's
 *   unmarked  its chat ended and Claude didn't mark it
 *   done      Claude marked it, with a note
 * The chat it went to is metadata, not a container.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Avatar from "boring-avatars";
import { ArrowUp, ArrowUpRight, MessageCircle, X } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useCommentActions } from "@/renderer/comments/use-comment-actions";
import { useCommentStore } from "@/renderer/comments/store";
import type { Actions, Cmt, Send } from "@/renderer/comments/model";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useConversationMessages } from "@/renderer/lib/claude-code-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { IconButton, MONO } from "./dial";
import { Empty } from "./sections";
import { elementLabel } from "./use-design";

/* ── Authors ───────────────────────────────────────────────────────────── */

// The workspace switcher's avatar palette (components/AvatarIcon).
const PALETTE = ["#c084a0", "#84a0c0", "#a0c084", "#c0a084", "#84c0a0"];

const You = ({ size = 18 }: { size?: number }) => (
  <span className="shrink-0 overflow-hidden rounded-[5px]" style={{ width: size, height: size }}>
    <Avatar size={size} name="you" variant="marble" colors={PALETTE} square />
  </span>
);

// The agent: antidraw's mark (antidraw-icon.svg), its cobalt tile and plates.
const Agent = ({ size = 16 }: { size?: number }) => (
  <span className="relative shrink-0 overflow-hidden rounded-[4px]" style={{ width: size, height: size, background: "linear-gradient(180deg, #3A5FB0, #1B3474)" }}>
    <svg viewBox="0 0 16 16" className="absolute inset-0 size-full">
      <rect x="6.5" y="6.5" width="6" height="6" rx="1.4" fill="#fff" opacity=".5" />
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.4" fill="#F4F7FD" />
    </svg>
  </span>
);

const ago = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

/* ── Small pieces ──────────────────────────────────────────────────────── */

export const Spinner = ({ className }: { className?: string }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className={cn("animate-spin", className)} style={{ animationDuration: "1.1s" }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".18" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const PinBadge = ({ n, open }: { n?: number; open?: boolean }) => (
  <span
    className={cn(
      "grid size-4 place-items-center rounded-full rounded-bl-none text-[9.5px] font-semibold leading-none",
      open ? "bg-[#3b82f6] text-white" : "bg-neutral-100 text-neutral-900",
    )}
  >
    {n}
  </span>
);

// Done: a ring with a check.
const Done = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".5" />
    <path d="m8.5 12.2 2.4 2.3 4.6-4.9" />
  </svg>
);

const ElName = ({ c }: { c: Cmt }) => (c.element ? <span className={cn(MONO, "text-[11px]")}>{elementLabel(c.element)}</span> : null);

// "Chat 3 ↗": the chat a comment went to, as a link.
const ChatLink = ({ n, onOpen }: { n: number; onOpen: () => void }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onOpen();
    }}
    className="inline-flex cursor-pointer items-center gap-0.5 hover:text-white/80"
    title={`Open Chat ${n}`}
  >
    Chat {n}
    <ArrowUpRight className="size-3" />
  </button>
);

const Hint = ({ children }: { children: ReactNode }) => <p className="m-0 px-3 py-6 text-center text-[12.5px] leading-[18px] text-white/35">{children}</p>;

/* ── A comment ─────────────────────────────────────────────────────────── */

// Where a comment has got to. Working is its chat's, not the comment's own:
// antidraw can't say which one the agent is on.
type Kind = "draft" | "working" | "unmarked" | "done";
const kindOf = (c: Cmt, s: Send | null): Kind => (!s ? "draft" : c.state === "done" ? "done" : s.phase === "ended" ? "unmarked" : "working");

const StatusMark = ({ kind, n }: { kind: Kind; n?: number }) =>
  kind === "draft" ? (
    <PinBadge n={n} />
  ) : kind === "working" ? (
    <span className="flex items-center gap-1.5 text-[11.5px]">
      <Spinner className="text-white/55" />
      <span className="dk-shimmer">Working</span>
    </span>
  ) : kind === "unmarked" ? (
    <span className="text-[11.5px] text-white/40">Not marked</span>
  ) : (
    <span className="text-white/40" title="Resolved">
      <Done />
    </span>
  );

const Card = ({ a, c, s, n }: { a: Actions; c: Cmt; s: Send | null; n?: number }) => {
  const kind = kindOf(c, s);
  const open = a.opened === c.id;
  // A not-sent one goes for good; one its chat left unmarked leaves the list.
  const remove = kind === "draft" ? () => a.remove(c.id) : kind === "unmarked" && s ? () => a.dismiss(s.n, c.id) : null;
  return (
    <div
      onMouseEnter={() => a.point(c.id)}
      onMouseLeave={() => a.point(null)}
      onClick={() => (open ? useCommentStore.getState().setOpened(null) : a.open(c.id))}
      className={cn("group flex cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5", open ? "bg-white/[0.06]" : "hover:bg-white/[0.035]")}
    >
      <You />
      <div className="min-w-0 flex-1">
        <div className="flex h-[18px] items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-white/85">You</span>
          <span className="text-[11.5px] text-white/35">{ago(c.at)}</span>
          <span className="flex-1" />
          <span className={cn("flex items-center", remove && "group-hover:hidden")}>
            <StatusMark kind={kind} n={n} />
          </span>
          {remove && (
            <IconButton
              title={kind === "draft" ? "Delete" : "Remove from the list"}
              onClick={() => {
                remove();
                a.point(null);
              }}
              className="hidden size-5 group-hover:grid"
            >
              <X className="size-3" />
            </IconButton>
          )}
        </div>
        <p className={cn("m-0 mt-0.5 break-words text-[13px] leading-[19px]", kind === "done" ? "text-white/55" : "text-white/85")}>{c.text}</p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] text-white/35">
          <span className="min-w-0 truncate">{c.frame}</span>
          {c.element && (
            <>
              <span className="shrink-0 text-white/20">·</span>
              <span className="shrink-0">
                <ElName c={c} />
              </span>
            </>
          )}
          {s && (
            <>
              <span className="shrink-0 text-white/20">·</span>
              <span className="shrink-0">
                <ChatLink n={s.n} onOpen={() => a.chat(s.conversationId)} />
              </span>
            </>
          )}
        </div>
        {/* The agent's reply: its note, from complete_comment. */}
        {kind === "done" && c.note && (
          <div className="mt-2.5 flex gap-2 border-l border-white/10 pl-2.5">
            <Agent />
            <div className="min-w-0 flex-1">
              <div className="flex h-4 items-center gap-1.5">
                <span className="text-[12px] font-medium text-white/75">Agent</span>
                {c.doneAt && <span className="text-[11.5px] text-white/35">{ago(c.doneAt)}</span>}
              </div>
              <p className="m-0 mt-0.5 break-words text-[12.5px] leading-[18px] text-white/60">{c.note}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Open · Resolved, as the panel's tabs: a faint chip on the picked one.
const Filter = ({ value, onChange, open, resolved }: { value: "open" | "resolved"; onChange: (v: "open" | "resolved") => void; open: number; resolved: number }) => (
  <div className="flex items-center gap-0.5">
    {(
      [
        ["open", "Open", open],
        ["resolved", "Resolved", resolved],
      ] as const
    ).map(([v, label, count]) => (
      <button
        key={v}
        type="button"
        onClick={() => onChange(v)}
        className={cn(
          "flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
          value === v ? "bg-white/[0.06] text-white/85" : "text-white/40 hover:text-white/65",
        )}
      >
        {label}
        {count > 0 && <span className="dk-mono text-[11px] text-white/30">{count}</span>}
      </button>
    ))}
  </div>
);

// The Send button's look: solid in the brand's ocean blue (the app icon's
// deep blue, white on it, 5.4:1), with a shine along its top and a soft glow
// of its own color under it.
const OCEAN = "#236CB6";
const SEND_LOOK: CSSProperties = {
  borderRadius: 8,
  background: OCEAN,
  color: "#FFFFFF",
  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), 0 6px 18px -6px color-mix(in srgb, ${OCEAN} 45%, transparent)`,
};

// The one thing to do: send what's not sent.
const SendBar = ({ count, disabled, onSend }: { count: number; disabled: boolean; onSend: () => void }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onSend}
    style={SEND_LOOK}
    className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium hover:brightness-110 active:brightness-95 disabled:cursor-default disabled:opacity-25"
  >
    {count === 1 ? "Send 1 comment to chat" : `Send ${count} comments to chat`}
    <ArrowUp className="size-3.5" />
  </button>
);

/* ── The section ───────────────────────────────────────────────────────── */

// The Comments section's body and footer. Sends go to the chat that's open,
// with its model and effort, as its composer's would.
export const useOutbox = () => {
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const { data: activeConversation } = useConversationMessages(activeConversationId);
  const composer = useComposerModel(activeConversationId, activeConversation);
  const { f, a, sending } = useCommentActions({ model: composer.selectedModelId, effort: composer.effort });
  // "5m ago" moves on.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const sent = f.sends.flatMap((s) => s.comments.map((c) => ({ c, s })));
  const openOnes = sent.filter(({ c }) => c.state !== "done").sort((x, y) => x.c.at - y.c.at);
  const resolved = sent.filter(({ c }) => c.state === "done").sort((x, y) => (y.c.doneAt ?? 0) - (x.c.doneAt ?? 0));
  const hasDone = f.sends.some((s) => s.phase === "ended" && s.comments.some((c) => c.state === "done"));
  const [view, setView] = useState<"open" | "resolved">("open");
  const list = view === "open" ? openOnes : resolved;

  // Above: what's gone to the agent, Open or Resolved.
  const body = sent.length ? (
    <div className="flex flex-col px-1.5 pt-1.5">
      <div className="flex h-8 items-center justify-between pl-1 pr-1">
        <Filter value={view} onChange={setView} open={openOnes.length} resolved={resolved.length} />
        {/* Done comments of ended chats off the list. */}
        {view === "resolved" && hasDone && (
          <button
            type="button"
            onClick={a.clearDone}
            title="Clear completed: take them off the list"
            className="flex h-6 shrink-0 cursor-pointer items-center rounded-md bg-white/[0.07] px-2 text-[11.5px] font-medium text-white/70 hover:bg-white/[0.12] hover:text-white"
          >
            Clear
          </button>
        )}
      </div>
      {list.length ? (
        <div className="flex flex-col gap-0.5 pt-1">
          {list.map(({ c, s }) => (
            <Card key={c.id} a={a} c={c} s={s} />
          ))}
        </div>
      ) : (
        <Hint>{view === "open" ? "Nothing with the agent right now." : "Nothing resolved yet."}</Hint>
      )}
    </div>
  ) : f.draft.length ? null : (
    <Empty icon={MessageCircle} title="No comments yet" body="Pick the Comment tool (C), then click anywhere on a frame to pin a note for the agent. Nothing goes out until you send." />
  );

  // Below, by Send: what you've written and not sent, as a composer holds a draft.
  const foot = f.draft.length ? (
    <div className="flex shrink-0 flex-col border-t border-white/[0.05]">
      <div className="flex h-8 items-center gap-1.5 px-3.5 pt-1.5">
        <span className="text-[11.5px] font-medium text-white/35">Not sent yet</span>
      </div>
      <div className="dk-scroll flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto px-1.5">
        {f.draft.map((c, i) => (
          <Card key={c.id} a={a} c={c} s={null} n={i + 1} />
        ))}
      </div>
      <div className="p-3 pt-2">
        <SendBar count={f.draft.length} disabled={sending} onSend={a.send} />
      </div>
    </div>
  ) : sent.length ? (
    <p className="m-0 shrink-0 border-t border-white/[0.05] px-3.5 py-3 text-[12px] text-white/35">Click a frame to leave a comment.</p>
  ) : null;

  return { body, foot, drafts: f.draft.length };
};

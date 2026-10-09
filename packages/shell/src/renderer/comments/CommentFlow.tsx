import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowUpRight, ChevronDown, CornerDownRight, Pencil, X } from "lucide-react";
import type { ChatPhase, Comment, CommentState } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { Ring } from "@/renderer/components/ui/tool";
import { Beam } from "@/renderer/components/AskUserQuestionCard";
import { frameNodeId, useFocusComponent } from "@/renderer/canvas/Canvas";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useGenerateTitle } from "@/renderer/lib/claude-code-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import type { CommentList } from "@/renderer/lib/api";
import { beside, BOX, CommentBoxAt, FLOAT, floatShadow, FrameCommentTarget, Kbd, useCloseOnClickAway } from "./pieces";
import {
  useAddComment,
  useClearCompleted,
  useComments,
  useCommentsChanged,
  useEditComment,
  useRemoveComment,
  useSendComments,
} from "@/renderer/lib/comment-ops";
import { setCanvasTool, useCommentStore, type Pos } from "./store";

// Comments for Claude, on the canvas, with the Comment tool on (design:
// CommentFlow, variation A — the box by the pin, the list at the top right).
//  - Click a frame to drop a pin there, on the element under it; the box
//    opens by it. ↵ adds a comment to the list; nothing reaches Claude until
//    Send.
//  - Clicking a comment — its row or its pin — opens it on the canvas. Edit
//    is an explicit action there (or the row's pencil); only not-sent
//    comments can be edited.
//  - Every send opens a new chat right away. Chats run side by side.
//  - A sent comment reads Sent until Claude marks it Completed (with a
//    note). One it doesn't mark just stays Sent: open the chat and carry on
//    there. × removes it.
//  - A set whose comments are all completed folds to one line. "Clear
//    completed" in the footer removes completed comments.
//  - A new chat is handed the earlier sets' comments and notes as history.

/* ── Model ─────────────────────────────────────────────────────────────── */

type CState = CommentState;
// `frame` is the component whose frame the pin is on.
type Cmt = { id: number; text: string; state: CState; pos: Pos; frame: string };
type Phase = ChatPhase;
type Send = { n: number; phase: Phase; conversationId: string; comments: Cmt[] };
type Flow = { draft: Cmt[]; sends: Send[] };

const isActive = (s: Send) => s.phase === "opening" || s.phase === "running";
const count = (s: Send, st: CState) => s.comments.filter((c) => c.state === st).length;
const allDone = (s: Send) => s.phase === "ended" && s.comments.every((c) => c.state === "done");

const cmt = (c: Comment): Cmt => ({ id: c.id, text: c.text, state: c.state, pos: { x: c.x, y: c.y }, frame: c.componentName });

const toFlow = (list: CommentList | undefined): Flow => {
  if (!list) return { draft: [], sends: [] };
  return {
    draft: list.comments.filter((c) => c.state === "draft").map(cmt),
    sends: list.chats
      .map((ch) => ({ ...ch, comments: list.comments.filter((c) => c.conversationId === ch.conversationId).map(cmt) }))
      .filter((s) => s.comments.length),
  };
};

/* ── Look ──────────────────────────────────────────────────────────────── */

const Pending = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray="2.6 3.2" strokeLinecap="round">
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".6" />
  </svg>
);

const TextBtn = ({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }}
    className={cn("cursor-pointer text-[12px] text-neutral-400 hover:text-neutral-100", className)}
  >
    {children}
  </button>
);

/* ── Pieces ────────────────────────────────────────────────────────────── */

type Actions = {
  add: (t: string) => void;
  send: () => void;
  remove: (id: number) => void;
  edit: (id: number, t: string) => void;
  dismiss: (n: number, id: number) => void;
  clearDone: () => void;
  // Hovering a row lights up its pin.
  point: (id: number | null) => void;
  // Opens a comment on the canvas, to read or (not sent only) to edit.
  open: (id: number, edit?: boolean) => void;
  opened: number | null;
  // Goes to a set's chat, in the side panel.
  chat: (conversationId: string) => void;
};

// Where a frame is on screen, and the canvas's zoom and width, so pins and
// the box can be placed by it. Null while the frame isn't on the canvas.
const useOrigin = (frame: string) => {
  const at = useStore((s) => s.nodeLookup.get(frameNodeId(frame))?.internals.positionAbsolute);
  const [tx, ty, k] = useStore((s) => s.transform);
  const w = useStore((s) => s.width);
  return at ? { ox: at.x * k + tx, oy: at.y * k + ty, k, w } : null;
};

// A point in a frame, on screen.
const usePoint = (frame: string, pos: Pos) => {
  const o = useOrigin(frame);
  return o && { x: o.ox + pos.x * o.k, y: o.oy + pos.y * o.k, w: o.w };
};

// A pin: a speech bubble whose tail sits on the point. Numbered while not
// sent, matching the list; grey once sent; gone once completed.
// Click one to open its comment; the open one turns blue.
const PinMark = ({ c, i, lit, a }: { c: Cmt; i?: number; lit: boolean; a: Actions }) => {
  const p = usePoint(c.frame, c.pos);
  if (!p) return null;
  const draft = c.state === "draft";
  const open = a.opened === c.id;
  return (
    <button
      type="button"
      data-comment-ui
      onClick={(e) => {
        e.stopPropagation();
        a.open(c.id);
      }}
      className={cn(
        "pointer-events-auto absolute z-10 grid -translate-y-full cursor-pointer place-items-center rounded-full rounded-bl-none text-[10px] font-semibold leading-none shadow-[0_2px_6px_rgba(0,0,0,.35)] transition-transform",
        open
          ? "size-5 bg-[#3b82f6] text-white ring-2 ring-white/90"
          : draft
            ? "size-5 bg-neutral-100 text-neutral-900"
            : "size-4 bg-[#4a4a4a] text-neutral-300 ring-1 ring-white/15",
        lit && !open && "scale-125 ring-2 ring-[#3b82f6]",
      )}
      style={{ left: p.x, top: p.y, transformOrigin: "bottom left" }}
    >
      {draft ? i : ""}
    </button>
  );
};

// Completed ones lose their pin, unless open.
const Pins = ({ f, lit, a }: { f: Flow; lit: number | null; a: Actions }) => (
  <>
    {f.sends.flatMap((s) => s.comments.filter((c) => c.state !== "done" || a.opened === c.id).map((c) => <PinMark key={c.id} c={c} lit={lit === c.id} a={a} />))}
    {f.draft.map((c, i) => (
      <PinMark key={c.id} c={c} i={i + 1} lit={lit === c.id} a={a} />
    ))}
  </>
);

// Beside the pin, on the canvas.
const useBeside = (frame: string, pos: Pos) => {
  const p = usePoint(frame, pos);
  return p && beside(p.x, p.y, p.w);
};

const CommentBox = ({ frame, pos, a, preset, onClose }: { frame: string; pos: Pos; a: Actions; preset?: string; onClose?: () => void }) => {
  const at = useBeside(frame, pos);
  return at && <CommentBoxAt at={at} add={a.add} send={a.send} preset={preset} onClose={onClose} />;
};

// An existing comment, opened on the canvas from its row or its pin. Reading:
// the text, and where it's at. Editing (not sent only): the text in a field,
// ↵ or Save to keep it, Esc or Cancel to leave it as it was.
const CommentCard = ({ f, id, editing, a, onClose }: { f: Flow; id: number; editing: boolean; a: Actions; onClose?: () => void }) => {
  const i = f.draft.findIndex((c) => c.id === id);
  const s = f.sends.find((x) => x.comments.some((c) => c.id === id));
  const c = i >= 0 ? f.draft[i] : s?.comments.find((x) => x.id === id);
  const [v, setV] = useState(c?.text ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [v, editing]);
  const at = useBeside(c?.frame ?? "", c?.pos ?? { x: 0, y: 0 });
  const w = useStore((st) => st.width);
  if (!c) return null;
  // Its frame isn't on the canvas (the component's gone, often by the
  // comment's own doing): beside the list instead, at the top.
  const { left, top } = at ?? { left: w - 16 - TRAY_W - 8 - BOX, top: 16 };
  const save = () => {
    if (v.trim()) a.edit(c.id, v);
    else a.remove(c.id);
    a.open(c.id, false);
  };
  const cancel = () => {
    setV(c.text);
    a.open(c.id, false);
  };
  return (
    <div
      data-comment-ui
      onClick={(e) => e.stopPropagation()}
      className={cn("pointer-events-auto absolute z-20 flex flex-col gap-2 p-3 ring-1 ring-white/20", FLOAT)}
      style={{ ...floatShadow, left, top, width: BOX }}
    >
      {!at && <p className="m-0 text-[12px] text-neutral-500">{c.frame} isn't on the canvas</p>}
      {editing ? (
        <textarea
          ref={ref}
          rows={1}
          autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(v.length, v.length)}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") return cancel();
            if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            save();
          }}
          className="-mx-1.5 -my-1 resize-none rounded bg-white/[0.05] px-1.5 py-1 text-[13px] leading-[19px] text-neutral-100 outline-none ring-1 ring-white/15 focus:ring-[#3b82f6]"
        />
      ) : (
        <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[19px] text-neutral-100">{c.text}</p>
      )}
      <div className="flex items-center gap-3 text-[12px]">
        {c.state === "draft" ? (
          editing ? (
            <>
              <span className="flex-1 text-neutral-500">
                <Kbd>↵</Kbd> save · <Kbd>esc</Kbd>
              </span>
              <TextBtn onClick={cancel}>Cancel</TextBtn>
              <button type="button" onClick={save} className="flex h-[24px] cursor-pointer items-center rounded-lg bg-[#e0e0e0] px-2.5 text-[12px] font-medium text-neutral-900 transition-colors hover:bg-white">
                Save
              </button>
            </>
          ) : (
            <>
              <span className="flex-1" />
              <TextBtn onClick={() => a.open(c.id, true)} className="flex items-center gap-1 font-medium text-neutral-200">
                <Pencil className="size-3" />
                Edit
              </TextBtn>
              <TextBtn
                onClick={() => {
                  a.remove(c.id);
                  onClose?.();
                }}
              >
                Delete
              </TextBtn>
            </>
          )
        ) : (
          <>
            {/* Only Completed is said: a sent one's row says Sent. */}
            <span className="flex-1 text-neutral-500">{c.state === "done" ? LABEL.done : ""}</span>
            <TextBtn onClick={() => s && a.chat(s.conversationId)} className="flex items-center gap-1 font-medium">
              <ArrowUpRight className="size-3.5" />
              Open chat
            </TextBtn>
            {s?.phase === "ended" && c.state === "sent" && (
              <TextBtn
                onClick={() => {
                  a.dismiss(s.n, c.id);
                  onClose?.();
                }}
              >
                Remove
              </TextBtn>
            )}
          </>
        )}
      </div>
    </div>
  );
};

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

const LABEL: Record<CState, string> = { draft: "", sent: "Sent", done: "Completed" };

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
  const label = s.phase === "opening" ? "Opening a new chat…" : null;
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

// The list, at the top right. Hidden until there's something in it.
const TRAY_W = 392;
const Tray = ({ f, a, sending }: { f: Flow; a: Actions; sending: boolean }) => {
  if (!f.draft.length && !f.sends.length) return null;
  const hasDone = f.sends.some((s) => s.phase === "ended" && count(s, "done") > 0);
  return (
    <div data-comment-ui onClick={(e) => e.stopPropagation()} className="pointer-events-auto absolute right-4 top-4 z-30 w-[392px]">
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

/* ── On the canvas ─────────────────────────────────────────────────────── */

// The click target over a canvas frame, at the canvas's zoom.
const CanvasFrameCommentTarget = ({ frame }: { frame: string }) => {
  const zoom = useStore((s) => s.transform[2]);
  return <FrameCommentTarget frame={frame} zoom={zoom} />;
};

export const renderFrameComments = ({ componentName }: { componentName: string }) => (
  <CanvasFrameCommentTarget frame={componentName} />
);

// The pins, the box, the open comment and the list, over the canvas. Mounted
// inside React Flow, for the frames' places on screen.
export const CommentFlow = () => {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const showConversation = useWorkspaceStore((s) => s.showConversation);
  const active = useCommentStore((s) => s.active);
  const box = useCommentStore((s) => s.box);
  const opened = useCommentStore((s) => s.opened);
  const lit = useCommentStore((s) => s.lit);
  const { setBox, setOpened, setLit } = useCommentStore.getState();

  useCommentsChanged(workspaceId);
  const { data } = useComments(workspaceId);
  const f = toFlow(data);

  const queryClient = useQueryClient();
  const addComment = useAddComment(workspaceId);
  const editComment = useEditComment(workspaceId);
  const removeComment = useRemoveComment(workspaceId);
  const clearCompleted = useClearCompleted(workspaceId);
  const sendComments = useSendComments(workspaceId);
  const generateTitle = useGenerateTitle();
  // A new chat's model and effort, as the composer's would be.
  const composer = useComposerModel(null, undefined);

  // A comment opened from the list whose pin is off screen: the canvas goes
  // to its frame first, as the component list's View does.
  const flow = useStoreApi();
  const focusComponent = useFocusComponent();
  const reveal = (id: number) => {
    const c = [...f.draft, ...f.sends.flatMap((s) => s.comments)].find((x) => x.id === id);
    if (!c) return;
    const { nodeLookup, transform, width, height } = flow.getState();
    const at = nodeLookup.get(frameNodeId(c.frame))?.internals.positionAbsolute;
    if (!at) return;
    const [tx, ty, k] = transform;
    const x = (at.x + c.pos.x) * k + tx;
    const y = (at.y + c.pos.y) * k + ty;
    if (x < 0 || y < 0 || x > width || y > height) focusComponent(c.frame);
  };

  // ⌘↵ adds and sends at once: the send waits for the adds still in flight.
  const adding = useRef(new Set<Promise<unknown>>());

  useCloseOnClickAway();

  // Every draft to a new chat, once the adds in flight have landed.
  const sendDrafts = async () => {
    await Promise.allSettled([...adding.current]);
    const list = queryClient.getQueryData<CommentList>(queryKeys.comments.byWorkspace(workspaceId));
    const drafts = list?.comments.filter((c) => c.state === "draft") ?? [];
    if (!drafts.length || !workspaceId) return;
    const { conversation } = await sendComments.mutateAsync({ drafts, model: composer.selectedModelId, effort: composer.effort });
    generateTitle.mutate({ conversationId: conversation.id, workspaceId, firstMessage: drafts.map((c) => c.text).join("\n") });
    return conversation;
  };

  // A frame's own window asking to show a comment it added (its Show), or
  // to send (its ⌘↵): this window has the list, and every frame to describe
  // the drafts' elements. A send opens its chat here.
  const latest = useRef({ sendDrafts, reveal });
  latest.current = { sendDrafts, reveal };
  useEffect(
    () =>
      // Optional: a renderer hot-reloaded over an older preload lacks it.
      window.electronAPI.onCommentsShown?.(({ commentId, send }) => {
        setCanvasTool("comment");
        void (async () => {
          await queryClient.refetchQueries({ queryKey: queryKeys.comments.byWorkspace(workspaceId) });
          latest.current.reveal(commentId);
          if (!send) return;
          const conversation = await latest.current.sendDrafts();
          if (conversation) showConversation(conversation.id);
        })().catch(console.error);
      }),
    [queryClient, workspaceId, showConversation],
  );

  const a: Actions = {
    add: (t) => {
      if (box && t.trim()) {
        const p = addComment.mutateAsync({ componentName: box.frame, x: box.pos.x, y: box.pos.y, text: t, element: box.element });
        adding.current.add(p);
        void p.catch(console.error).finally(() => adding.current.delete(p));
      }
      setBox(null);
    },
    send: () => void sendDrafts().catch(console.error),
    remove: (id) => removeComment.mutate(id),
    edit: (id, t) => (t.trim() ? editComment.mutate({ commentId: id, text: t }) : removeComment.mutate(id)),
    dismiss: (_n, id) => removeComment.mutate(id),
    clearDone: () => clearCompleted.mutate(),
    point: setLit,
    // From the list with another tool on, it switches to Comment: the card
    // sits by the pin, and pins are the Comment tool's.
    open: (id, edit = false) => {
      if (!useCommentStore.getState().active) setCanvasTool("comment");
      setBox(null);
      setOpened({ id, edit });
      reveal(id);
    },
    opened: opened?.id ?? null,
    chat: showConversation,
  };

  // The list shows whatever the tool, while there's something in it, so
  // Claude's progress stays in sight. Pins, the box and the open comment are
  // the Comment tool's.
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {active && <Pins f={f} lit={lit} a={a} />}
      {active && box && <CommentBox key={`${box.frame},${box.pos.x},${box.pos.y}`} frame={box.frame} pos={box.pos} a={a} onClose={() => setBox(null)} />}
      {active && opened && <CommentCard key={`${opened.id}-${opened.edit}`} f={f} id={opened.id} editing={opened.edit} a={a} onClose={() => setOpened(null)} />}
      <Tray f={f} a={a} sending={sendComments.isPending} />
      {active && !box && !f.sends.length && (
        <p className="pointer-events-none absolute left-1/2 top-4 m-0 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-[12px] text-neutral-300">Click a frame to comment</p>
      )}
    </div>
  );
};

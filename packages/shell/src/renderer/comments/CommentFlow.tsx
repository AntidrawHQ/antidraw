import { useEffect, useRef, useState } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Pencil } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { frameNodeId, useFocusComponent } from "@/renderer/canvas/Canvas";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useConversationMessages } from "@/renderer/lib/claude-code-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useCommentsChanged } from "@/renderer/lib/comment-ops";
import type { CommentList } from "@/renderer/lib/api";
import { beside, BOX, CommentBoxAt, FLOAT, floatShadow, FrameCommentTarget, Kbd, TextBtn, useCloseOnClickAway } from "./pieces";
import { LABEL, type Actions, type Cmt, type Flow } from "./model";
import { sayNotOnCanvas, useCommentActions } from "./use-comment-actions";
import { Tray, TRAY_W } from "./CommentTray";
import { setCanvasTool, useCommentStore, type Pos } from "./store";

// Comments for Claude, on the canvas, with the Comment tool on (design:
// CommentFlow, variation A — the box by the pin, the list at the top right:
// CommentTray).
//  - Click a frame to drop a pin there, on the element under it; the box
//    opens by it. ↵ adds a comment to the list; nothing reaches Claude until
//    Send.
//  - Clicking a comment — its row or its pin — opens it on the canvas. Edit
//    is an explicit action there (or the row's pencil); only not-sent
//    comments can be edited.
//  - Send goes to the chat that's open, as a message typed there would
//    (queued if it's mid-turn), so Claude has that chat's context; with none
//    open, to a new chat. A chat's comments are its set. Chats run side by
//    side.
//  - A sent comment reads Sent until Claude marks it Completed (with a
//    note). One it doesn't mark just stays Sent: open the chat and carry on
//    there. × removes it.
//  - A set whose comments are all completed folds to one line. "Clear
//    completed" in the footer removes completed comments.
//  - A new chat is handed the earlier sets' comments and notes as history.

/* ── Pieces ────────────────────────────────────────────────────────────── */

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
  // comment's own doing): beside the list instead, at the top, inside the
  // canvas.
  const { left, top } = at ?? { left: Math.max(16, w - 16 - TRAY_W - 8 - BOX), top: 16 };
  const save = () => {
    // Emptied, it's gone, and so is its card.
    if (!v.trim()) return a.remove(c.id);
    a.edit(c.id, v);
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
      className={cn("pointer-events-auto absolute z-40 flex flex-col gap-2 p-3 ring-1 ring-white/20", FLOAT)}
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
  const { setBox, setOpened } = useCommentStore.getState();
  const queryClient = useQueryClient();

  useCommentsChanged(workspaceId);
  // Sends from here (the box's ⌘↵, a frame window's) go to the chat that's
  // open, with its model and effort, as its composer's would.
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const { data: activeConversation } = useConversationMessages(activeConversationId);
  const composer = useComposerModel(activeConversationId, activeConversation);
  const { f, a, sendDrafts, sending } = useCommentActions({ model: composer.selectedModelId, effort: composer.effort });

  // An opened comment whose pin is off screen: the canvas goes to its frame,
  // as the component list's View does. A comment opened from the list is the
  // usual case.
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
  const openedId = opened?.id;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (openedId !== undefined) revealRef.current(openedId);
  }, [openedId]);

  useEffect(() => {
    useCommentStore.setState({ onCanvas: (frame) => flow.getState().nodeLookup.has(frameNodeId(frame)) });
    return () => useCommentStore.setState({ onCanvas: () => false });
  }, [flow]);

  useCloseOnClickAway();

  // A frame's own window asking to show a comment it added (its Show), or
  // to send (its ⌘↵): this window has the list, and every frame to describe
  // the drafts' elements. A send opens its chat here. Only for this
  // workspace: a frame window outlives a workspace switch, and its comment
  // is another workspace's, as the drafts here would be to it.
  const latest = useRef({ sendDrafts, reveal });
  latest.current = { sendDrafts, reveal };
  useEffect(
    () =>
      // Optional: a renderer hot-reloaded over an older preload lacks it.
      window.electronAPI.onCommentsShown?.((request) => {
        if (request.workspaceId !== workspaceId) return;
        const { commentId, send } = request;
        void (async () => {
          const queryKey = queryKeys.comments.byWorkspace(workspaceId);
          await queryClient.refetchQueries({ queryKey });
          const list = queryClient.getQueryData<CommentList>(queryKey);
          // Shown on the canvas only where its frame is; the send goes either way.
          const c = list?.comments.find((x) => x.id === commentId);
          if (c && !useCommentStore.getState().onCanvas(c.componentName)) sayNotOnCanvas(c.componentName);
          else {
            setCanvasTool("comment");
            latest.current.reveal(commentId);
          }
          if (!send) return;
          // The send is for the comment the frame window just added: without
          // it among the drafts, there's nothing it asked to send.
          if (!list?.comments.some((c) => c.id === commentId && c.state === "draft")) return;
          const conversationId = await latest.current.sendDrafts();
          if (conversationId) showConversation(conversationId);
        })().catch(console.error);
      }),
    [queryClient, workspaceId, showConversation],
  );

  // The list shows whatever the tool, while there's something in it, so
  // Claude's progress stays in sight. Pins, the box and the open comment are
  // the Comment tool's.
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {active && <Pins f={f} lit={lit} a={a} />}
      {active && box && <CommentBox key={`${box.frame},${box.pos.x},${box.pos.y}`} frame={box.frame} pos={box.pos} a={a} onClose={() => setBox(null)} />}
      {active && opened && <CommentCard key={`${opened.id}-${opened.edit}`} f={f} id={opened.id} editing={opened.edit} a={a} onClose={() => setOpened(null)} />}
      <Tray f={f} a={a} sending={sending} />
      {active && !box && !f.sends.length && (
        <p className="pointer-events-none absolute left-1/2 top-4 m-0 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-[12px] text-neutral-300">Click a frame to comment</p>
      )}
    </div>
  );
};

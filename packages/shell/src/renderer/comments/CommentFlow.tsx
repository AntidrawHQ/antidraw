import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { frameNodeId, useFocusComponent } from "@/renderer/canvas/Canvas";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useConversationMessages } from "@/renderer/lib/claude-code-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useCommentsChanged } from "@/renderer/lib/comment-ops";
import type { CommentList } from "@/renderer/lib/api";
import { CommentBoxAt, FrameCommentTarget, useCloseOnClickAway } from "./pieces";
import { CommentCard, PlacementContext, Pins, useBeside, type Placement } from "./placed";
import { useAnchoredFlow } from "./anchors";
import type { Actions } from "./model";
import { sayNotOnCanvas, useCommentActions } from "./use-comment-actions";
import { setCanvasTool, useCommentStore, type Pos } from "./store";

// Comments for Claude, on the canvas, with the Comment tool on (design:
// CommentFlow, variation A — the box by the pin; the list is the chat panel's,
// above the composer: ChatComments).
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

// Where a point in a frame is on screen, by the canvas's pan and zoom.
const CanvasPlacement = ({ children }: { children: ReactNode }) => {
  const flow = useStoreApi();
  // Each a change in where frames are on screen.
  const nodes = useStore((s) => s.nodes);
  const [tx, ty, k] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const value = useMemo<Placement>(
    () => ({
      width,
      at: (frame, pos) => {
        const at = flow.getState().nodeLookup.get(frameNodeId(frame))?.internals.positionAbsolute;
        return at ? { x: (at.x + pos.x) * k + tx, y: (at.y + pos.y) * k + ty } : null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `nodes` is when they move.
    [flow, nodes, tx, ty, k, width],
  );
  return <PlacementContext.Provider value={value}>{children}</PlacementContext.Provider>;
};

const CommentBox = ({ frame, pos, a, preset, onClose }: { frame: string; pos: Pos; a: Actions; preset?: string; onClose?: () => void }) => {
  const at = useBeside(frame, pos);
  return at && <CommentBoxAt at={at} add={a.add} send={a.send} preset={preset} onClose={onClose} />;
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
  const { f: listed, a, sendDrafts } = useCommentActions({ model: composer.selectedModelId, effort: composer.effort });
  // Pins on their elements, while they're showing.
  const f = useAnchoredFlow(listed, () => active);

  // An opened comment whose pin is off screen: the canvas goes to its frame,
  // as the component list's View does. A comment opened from the chat's list
  // is the usual case.
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
        const { commentId, send, chat } = request;
        void (async () => {
          const queryKey = queryKeys.comments.byWorkspace(workspaceId);
          await queryClient.refetchQueries({ queryKey });
          const list = queryClient.getQueryData<CommentList>(queryKey);
          // The comments list is the chat panel's: open it, folded or not, on
          // the comment's own chat where it asked for that.
          if (chat) showConversation(chat);
          else useWorkspaceStore.getState().setActiveSidePanel("chat");
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

  // The list is the chat panel's (ChatComments). Here: the pins, the box and
  // the open comment, all the Comment tool's.
  if (!active) return null;
  return (
    <CanvasPlacement>
      <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
        <Pins f={f} lit={lit} a={a} />
        {box && <CommentBox key={`${box.frame},${box.pos.x},${box.pos.y}`} frame={box.frame} pos={box.pos} a={a} onClose={() => setBox(null)} />}
        {opened && <CommentCard key={`${opened.id}-${opened.edit}`} f={f} id={opened.id} editing={opened.edit} a={a} onClose={() => setOpened(null)} />}
        {!box && !f.sends.length && (
          <p className="pointer-events-none absolute left-1/2 top-4 m-0 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-[12px] text-neutral-300">Click a frame to comment</p>
        )}
      </div>
    </CanvasPlacement>
  );
};

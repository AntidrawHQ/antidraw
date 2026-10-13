import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Comment } from "@/main/api";
import { addComment } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useComments, useCommentsChanged, useEditComment, useRemoveComment } from "@/renderer/lib/comment-ops";
import { getElementContext } from "@/renderer/inspector/bridge";
import { beside, CommentBoxAt, FrameCommentTarget, useCloseOnClickAway } from "./pieces";
import { CommentCard, PlacementContext, Pins, type Placement } from "./placed";
import { useAnchoredFlow } from "./anchors";
import { toFlow, type Actions } from "./model";
import { setCanvasTool, useCommentStore } from "./store";

// The Comment tool in a frame's own window (PreviewWindow), at zoom 1 over
// the frame: its clicks and the box, and this frame's pins, each on
// its element as this window shows it, with the comment a pin opens. The
// list is the main window's, which a comment added here joins (by the
// comments event stream). ⌘↵ hands the send to the main window, which has
// every frame to describe the drafts' elements, and opens its chat there;
// so does a sent comment's Open chat.

const useWindowWidth = () => {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
};

export const PreviewComments = ({
  frame,
  workspaceId,
  onAdded,
}: {
  frame: string;
  workspaceId: string;
  onAdded: (comment: Comment) => void;
}) => {
  const active = useCommentStore((s) => s.active);
  const box = useCommentStore((s) => (s.box?.frame === frame ? s.box : null));
  const opened = useCommentStore((s) => s.opened);
  const lit = useCommentStore((s) => s.lit);
  const last = useRef<Promise<Comment | null>>(Promise.resolve(null));
  const queryClient = useQueryClient();
  useCloseOnClickAway();

  // Every comment, so a draft's pin has its number in the main window's
  // list; only this frame's are placed here.
  useCommentsChanged(workspaceId);
  const { data } = useComments(workspaceId);
  const listed = useMemo(() => toFlow(data), [data]);
  const f = useAnchoredFlow(listed, (of) => active && of === frame);
  const editComment = useEditComment(workspaceId);
  const removeComment = useRemoveComment(workspaceId);

  const width = useWindowWidth();
  const placement = useMemo<Placement>(() => ({ width, at: (of, pos) => (of === frame ? pos : null) }), [width, frame]);

  const add = (t: string) => {
    if (box && t.trim()) {
      const { element, pos } = box;
      // The element as this window sees it, kept with it (`seen`): the
      // canvas's frame is another page, at another size (comment-ops).
      last.current = (element ? getElementContext([{ frame, info: element }]) : Promise.resolve([null]))
        .then(([seen]) =>
          addComment(workspaceId, { componentName: frame, x: pos.x, y: pos.y, text: t.trim(), element: element && { ...element, seen: seen ?? null } }),
        )
        .then((r) => {
          if (r.isErr()) {
            console.error("Failed to add comment:", r.error.message);
            return null;
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.comments.byWorkspace(workspaceId) });
          onAdded(r.value);
          return r.value;
        });
    }
    useCommentStore.getState().setBox(null);
  };

  // A comment that goes away takes its open card with it.
  const remove = (id: number) => {
    const s = useCommentStore.getState();
    if (s.opened?.id === id) s.setOpened(null);
    removeComment.mutate(id);
  };
  const a: Actions = {
    add,
    send: () => void last.current.then((c) => c && window.electronAPI.showComments({ workspaceId, commentId: c.id, send: true })),
    remove,
    edit: (id, t) => (t.trim() ? editComment.mutate({ commentId: id, text: t }) : remove(id)),
    dismiss: (_n, id) => remove(id),
    // Clearing is the list's, in the main window.
    clearDone: () => {},
    point: (id) => useCommentStore.getState().setLit(id),
    open: (id, edit = false) => {
      const s = useCommentStore.getState();
      if (!s.active) setCanvasTool("comment");
      s.setBox(null);
      s.setOpened({ id, edit });
    },
    opened: opened?.id ?? null,
    chat: (conversationId) => {
      if (opened) void window.electronAPI.showComments({ workspaceId, commentId: opened.id, send: false, chat: conversationId });
    },
  };

  return (
    <PlacementContext.Provider value={placement}>
      <FrameCommentTarget frame={frame} />
      {active && (
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
          <Pins f={f} lit={lit} a={a} />
          {box && (
            <CommentBoxAt
              key={`${box.pos.x},${box.pos.y}`}
              at={beside(box.pos.x, box.pos.y, width)}
              add={add}
              send={a.send}
              onClose={() => useCommentStore.getState().setBox(null)}
            />
          )}
          {opened && <CommentCard key={`${opened.id}-${opened.edit}`} f={f} id={opened.id} editing={opened.edit} a={a} onClose={() => useCommentStore.getState().setOpened(null)} />}
        </div>
      )}
    </PlacementContext.Provider>
  );
};

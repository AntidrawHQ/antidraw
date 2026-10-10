import { useRef } from "react";
import type { Comment } from "@/main/api";
import { addComment } from "@/renderer/lib/api";
import { getElementContext } from "@/renderer/inspector/bridge";
import { beside, CommentBoxAt, FrameCommentTarget, useCloseOnClickAway } from "./pieces";
import { useCommentStore } from "./store";

// The Comment tool in a frame's own window (PreviewWindow): the click target
// and the box, at zoom 1 over the frame. No pins and no list: those are the
// main window's, whose list a comment added here joins (by the comments
// event stream). ⌘↵ hands the send to the main window, which has every
// frame to describe the drafts' elements, and opens its chat there.
export const PreviewComments = ({
  frame,
  workspaceId,
  onAdded,
}: {
  frame: string;
  workspaceId: string;
  onAdded: (comment: Comment) => void;
}) => {
  const box = useCommentStore((s) => (s.box?.frame === frame ? s.box : null));
  const layer = useRef<HTMLDivElement>(null);
  const last = useRef<Promise<Comment | null>>(Promise.resolve(null));
  useCloseOnClickAway();

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
          onAdded(r.value);
          return r.value;
        });
    }
    useCommentStore.getState().setBox(null);
  };
  const send = () => {
    void last.current.then((c) => c && window.electronAPI.showComments({ workspaceId, commentId: c.id, send: true }));
  };

  return (
    <>
      <FrameCommentTarget frame={frame} />
      <div ref={layer} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
        {box && (
          <CommentBoxAt
            key={`${box.pos.x},${box.pos.y}`}
            at={beside(box.pos.x, box.pos.y, layer.current?.offsetWidth ?? Infinity)}
            add={add}
            send={send}
            onClose={() => useCommentStore.getState().setBox(null)}
          />
        )}
      </div>
    </>
  );
};

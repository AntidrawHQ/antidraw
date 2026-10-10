import { useRef } from "react";
import type { Comment } from "@/main/api";
import { addComment } from "@/renderer/lib/api";
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
      last.current = addComment(workspaceId, { componentName: frame, x: box.pos.x, y: box.pos.y, text: t.trim(), element: box.element as Record<string, unknown> | null }).then((r) => {
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

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EffortLevel } from "@/main/api";
import type { CommentList } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import {
  useAddComment,
  useClearCompleted,
  useComments,
  useEditComment,
  useRemoveComment,
  useSendComments,
} from "@/renderer/lib/comment-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useConversationMessages } from "@/renderer/lib/claude-code-ops";
import { toFlow, type Actions } from "./model";
import { FLOAT, floatShadow } from "./pieces";
import { setCanvasTool, useCommentStore } from "./store";

// A comment whose frame isn't on the canvas (it's gone, or there's no canvas
// up) has nowhere to go to: say so, rather than switch tools to nothing.
export const sayNotOnCanvas = (frame: string) =>
  toast(`${frame} isn't on the canvas`, {
    id: "comment-not-on-canvas",
    className: `${FLOAT} px-3 py-2 text-[13px] text-neutral-200`,
    style: floatShadow,
  });

// ⌘↵ adds and sends at once: a send waits for the adds still in flight,
// whichever surface made them (the canvas's box, the chat's list).
const adding = new Set<Promise<unknown>>();

// The workspace's comments and what can be done with them, for the canvas
// (CommentFlow) and the chat panel's list (ChatComments). A send uses
// `model`/`effort`: the caller's composer's.
export const useCommentActions = ({ model, effort }: { model?: string; effort?: EffortLevel }) => {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const showConversation = useWorkspaceStore((s) => s.showConversation);
  const opened = useCommentStore((s) => s.opened);
  const { data } = useComments(workspaceId);
  // The open chat's own sets go by its live status, which its stream keeps
  // (an error included): not streaming, its turn has ended, whatever the
  // list last read. Streaming, the list says whether it's still opening.
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const { data: chat } = useConversationMessages(activeConversationId);
  const listed = toFlow(data);
  const f = {
    ...listed,
    sends: listed.sends.map((s) =>
      s.conversationId !== activeConversationId || !chat
        ? s
        : {
            ...s,
            phase:
              chat.streamStatus !== "streaming" ? ("ended" as const) : s.phase === "ended" ? ("running" as const) : s.phase,
          },
    ),
  };

  const queryClient = useQueryClient();
  const addComment = useAddComment(workspaceId);
  const editComment = useEditComment(workspaceId);
  const removeComment = useRemoveComment(workspaceId);
  const clearCompleted = useClearCompleted(workspaceId);
  const sendComments = useSendComments(workspaceId);

  // Every draft to the open chat, or a new one that then opens, once the
  // adds in flight have landed.
  const sendDrafts = async () => {
    await Promise.allSettled([...adding]);
    const list = queryClient.getQueryData<CommentList>(queryKeys.comments.byWorkspace(workspaceId));
    const drafts = list?.comments.filter((c) => c.state === "draft") ?? [];
    return sendComments.send({ drafts, model, effort });
  };

  // A comment that goes away takes its open card with it.
  const closeIf = (id: number) => {
    const s = useCommentStore.getState();
    if (s.opened?.id === id) s.setOpened(null);
  };

  const a: Actions = {
    add: (t) => {
      const { box, setBox } = useCommentStore.getState();
      if (box && t.trim()) {
        const p = addComment.mutateAsync({ componentName: box.frame, x: box.pos.x, y: box.pos.y, text: t, element: box.element });
        adding.add(p);
        void p.catch(console.error).finally(() => adding.delete(p));
      }
      setBox(null);
    },
    send: () => void sendDrafts().catch(console.error),
    remove: (id) => {
      closeIf(id);
      removeComment.mutate(id);
    },
    edit: (id, t) => {
      if (t.trim()) return editComment.mutate({ commentId: id, text: t });
      closeIf(id);
      removeComment.mutate(id);
    },
    dismiss: (_n, id) => {
      closeIf(id);
      removeComment.mutate(id);
    },
    clearDone: () => {
      const open = useCommentStore.getState().opened;
      const done = f.sends.some((s) => s.phase === "ended" && s.comments.some((c) => c.id === open?.id && c.state === "done"));
      if (open && done) closeIf(open.id);
      clearCompleted.mutate();
    },
    point: (id) => useCommentStore.getState().setLit(id),
    // On the canvas, by its pin: from the chat's list with another tool on,
    // it switches to Comment (pins are the Comment tool's), and the canvas
    // goes to it (CommentFlow).
    open: (id, edit = false) => {
      const s = useCommentStore.getState();
      const c = [...f.draft, ...f.sends.flatMap((x) => x.comments)].find((x) => x.id === id);
      if (c && !s.onCanvas(c.frame)) return void sayNotOnCanvas(c.frame);
      if (!s.active) setCanvasTool("comment");
      s.setBox(null);
      s.setOpened({ id, edit });
    },
    opened: opened?.id ?? null,
    chat: showConversation,
  };

  return { f, a, sendDrafts, sending: sendComments.isPending };
};

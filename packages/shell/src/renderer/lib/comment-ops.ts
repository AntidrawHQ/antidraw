import { useEffect, useState } from "react";
import type { Result } from "neverthrow";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Comment, EffortLevel } from "@/main/api";
import type { ElementContext, ElementInfo } from "@antidrawapp/runtime/inspector";
import type { CommentContext } from "@/shared/utils/canvas-comments";
import { frameUrl, getElementContext } from "@/renderer/inspector/bridge";
import { describeContext, describeLastSeen } from "@/renderer/inspector/tags";
import { queryKeys } from "./query-keys";
import { useSendToChat } from "@/renderer/hooks/use-send-to-chat";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import {
  addComment,
  clearCompletedComments,
  editComment,
  listComments,
  removeComment,
  commentsPrompt,
  watchComments,
  type CommentList,
} from "./api";

// The canvas's comments for Claude, and the chats their sets went to.
export const useComments = (workspaceId: string | null) =>
  useQuery({
    queryKey: queryKeys.comments.byWorkspace(workspaceId),
    queryFn: workspaceId
      ? async () => {
          const result = await listComments(workspaceId);
          if (result.isErr()) throw new Error(result.error.message);
          return result.value;
        }
      : skipToken,
  });

// One stream per workspace, however many places watch its comments: the last
// to unmount closes it.
const watching = new Map<string, { users: number; stop: () => void }>();

// The list's news, from the workspace's comments event stream: any write,
// the user's or Claude's, or a comment chat moving on. Each refetches.
export const useCommentsChanged = (workspaceId: string | null) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workspaceId) return;
    const queryKey = queryKeys.comments.byWorkspace(workspaceId);
    const watch = watching.get(workspaceId) ?? {
      users: 0,
      stop: watchComments(workspaceId, () => void queryClient.invalidateQueries({ queryKey })),
    };
    watch.users++;
    watching.set(workspaceId, watch);
    return () => {
      if (--watch.users > 0) return;
      watch.stop();
      watching.delete(workspaceId);
    };
  }, [workspaceId, queryClient]);
};

const useCommentMutation = <V, R>(
  workspaceId: string | null,
  run: (workspaceId: string, vars: V) => Promise<R>,
  update?: (list: CommentList, result: R, vars: V) => CommentList,
) => {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.comments.byWorkspace(workspaceId);
  return useMutation({
    mutationFn: (vars: V) => {
      if (!workspaceId) throw new Error("No workspace");
      return run(workspaceId, vars);
    },
    onSuccess: (result, vars) => {
      if (update) queryClient.setQueryData<CommentList>(queryKey, (old) => old && update(old, result, vars));
      else void queryClient.invalidateQueries({ queryKey });
    },
  });
};

const unwrap = async <T>(result: Promise<Result<T, { message: string }>>) => {
  const r = await result;
  if (r.isErr()) throw new Error(r.error.message);
  return r.value;
};

export const useAddComment = (workspaceId: string | null) =>
  useCommentMutation(
    workspaceId,
    (id, c: Pick<Comment, "componentName" | "x" | "y" | "text"> & { element: ElementInfo | null }) =>
      unwrap(addComment(id, { ...c, element: c.element as Record<string, unknown> | null })),
    (list, row) => ({ ...list, comments: [...list.comments, row] }),
  );

export const useEditComment = (workspaceId: string | null) =>
  useCommentMutation(
    workspaceId,
    (id, { commentId, text }: { commentId: number; text: string }) => unwrap(editComment(id, commentId, text)),
    (list, row) => ({ ...list, comments: list.comments.map((c) => (c.id === row.id ? row : c)) }),
  );

// A draft goes; a sent one leaves the list (its chat keeps it as history).
export const useRemoveComment = (workspaceId: string | null) =>
  useCommentMutation(workspaceId, (id, commentId: number) => unwrap(removeComment(id, commentId)));

export const useClearCompleted = (workspaceId: string | null) =>
  useCommentMutation(workspaceId, (id, _: void) => unwrap(clearCompletedComments(id)));

// A comment's element as saved. One left in a frame's own window also has
// what that window said about it then (`seen`, null if it couldn't say).
type SavedElement = ElementInfo & { seen?: ElementContext | null };

// The <element> under each draft's pin, as its frame sees it now: an edit
// may have moved it. As last seen, where the frame doesn't answer. One left
// in a frame's own window is as that window saw it: the canvas's frame is
// another page, at another size, where its ref can name another element.
export const describeElements = async (drafts: Comment[]): Promise<CommentContext[]> => {
  const picks = drafts.flatMap((c) =>
    c.element ? [{ id: c.id, pick: { frame: c.componentName, info: c.element as unknown as SavedElement } }] : [],
  );
  const asked = picks.filter((p) => p.pick.info.seen === undefined);
  const contexts = await getElementContext(asked.map((p) => p.pick));
  const told = new Map(asked.map((p, i) => [p.id, contexts[i] ?? null]));
  const seen = new Map(picks.map((p) => [p.id, p.pick.info.seen !== undefined ? p.pick.info.seen : (told.get(p.id) ?? null)]));
  const blocks = new Map(
    picks.map((p) => [p.id, seen.get(p.id) ? describeContext(seen.get(p.id)!) : describeLastSeen(p.pick)]),
  );
  // The frame's size, which the element's box is read at, as Inspect gives it.
  const viewports = new Map(picks.map((p) => [p.id, seen.get(p.id)?.viewport.join("×") ?? null]));
  return drafts.map((c) => ({
    id: c.id,
    element: blocks.get(c.id) ?? null,
    preview: frameUrl(c.componentName),
    frame: viewports.get(c.id) ?? null,
  }));
};

// Sends the drafts to the chat that's open, or a new one if none is, as a
// chat message: the server writes the message (POST /comments/prompt), and
// it goes out through the composer's own send (useSendToChat), which marks
// them sent with it. Resolves to the chat they went to.
export const useSendComments = (workspaceId: string | null) => {
  const queryClient = useQueryClient();
  const sendToChat = useSendToChat();
  const [describing, setDescribing] = useState(false);

  const send = async ({ drafts, model, effort }: { drafts: Comment[]; model?: string; effort?: EffortLevel }) => {
    if (!workspaceId || !drafts.length) return;
    const into = useWorkspaceStore.getState().activeConversationId ?? undefined;
    setDescribing(true);
    let message: { ids: number[]; prompt: string };
    try {
      const context = await describeElements(drafts);
      message = await unwrap(commentsPrompt(workspaceId, { context, conversationId: into }));
    } finally {
      setDescribing(false);
    }
    const sent = new Set(message.ids);
    const conversationId = await sendToChat.send({
      prompt: message.prompt,
      model,
      effort,
      commentIds: message.ids,
      title: drafts.filter((c) => sent.has(c.id)).map((c) => c.text).join("\n"),
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.comments.byWorkspace(workspaceId) });
    return conversationId;
  };

  return { send, isPending: describing || sendToChat.isPending };
};

import { useEffect } from "react";
import type { Result } from "neverthrow";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Comment, Conversation, EffortLevel } from "@/main/api";
import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { frameUrl, getElementContext } from "@/renderer/inspector/bridge";
import { describeContext, describeLastSeen } from "@/renderer/inspector/tags";
import { queryKeys } from "./query-keys";
import {
  addComment,
  clearCompletedComments,
  editComment,
  listComments,
  removeComment,
  sendComments,
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

// The list's news, from the workspace's comments event stream: any write,
// the user's or Claude's, or a comment chat moving on. Each refetches.
export const useCommentsChanged = (workspaceId: string | null) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workspaceId) return;
    const queryKey = queryKeys.comments.byWorkspace(workspaceId);
    return watchComments(workspaceId, () => void queryClient.invalidateQueries({ queryKey }));
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

// The <element> under each draft's pin, as its frame sees it now: an edit
// may have moved it. As last seen, where the frame doesn't answer.
const describeElements = async (drafts: Comment[]) => {
  const picks = drafts.flatMap((c) =>
    c.element ? [{ id: c.id, pick: { frame: c.componentName, info: c.element as unknown as ElementInfo } }] : [],
  );
  const contexts = await getElementContext(picks.map((p) => p.pick));
  const blocks = new Map(
    picks.map((p, i) => [p.id, contexts[i] ? describeContext(contexts[i]!) : describeLastSeen(p.pick)]),
  );
  // The frame's size, which the element's box is read at, as Inspect gives it.
  const viewports = new Map(picks.map((p, i) => [p.id, contexts[i]?.viewport.join("×") ?? null]));
  return drafts.map((c) => ({
    id: c.id,
    element: blocks.get(c.id) ?? null,
    preview: frameUrl(c.componentName),
    frame: viewports.get(c.id) ?? null,
  }));
};

// Every send opens a new chat right away, alongside any already running.
export const useSendComments = (workspaceId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ drafts, model, effort }: { drafts: Comment[]; model?: string; effort?: EffortLevel }) => {
      if (!workspaceId) throw new Error("No workspace");
      const context = await describeElements(drafts);
      return unwrap(sendComments(workspaceId, { context, model, effort }));
    },
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<Conversation[]>(
        queryKeys.conversations.byWorkspace(conversation.workspaceId),
        (old) => (old ? [conversation, ...old] : old),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.byWorkspace(workspaceId) });
    },
  });
};

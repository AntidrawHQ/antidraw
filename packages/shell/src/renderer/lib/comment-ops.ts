import { useEffect, useState } from "react";
import type { Result } from "neverthrow";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Comment, EffortLevel } from "@/main/api";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import type { CommentContext } from "@/shared/utils/canvas-comments";
import { frameUrl, getElementContext } from "@/renderer/inspector/bridge";
import { describeContext, describeLastSeen, usableContext } from "@/renderer/inspector/tags";
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

// A comment's element with what its frame says about it now (`seen`, null if
// it couldn't say): the comment goes to Claude as that, whatever the page
// does after.
export const withSeen = async (frame: string, element: ElementInfo | null): Promise<SavedElement | null> =>
  element && { ...element, seen: (await getElementContext([{ frame, info: element }]))[0] ?? null };

export const useAddComment = (workspaceId: string | null) =>
  useCommentMutation(
    workspaceId,
    async (id, c: Pick<Comment, "componentName" | "x" | "y" | "text"> & { element: ElementInfo | null }) =>
      unwrap(addComment(id, { ...c, element: (await withSeen(c.componentName, c.element)) as Record<string, unknown> | null })),
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

// A comment's element as saved, with what its frame said about it then
// (`seen`, null if it couldn't say; none from before comments kept it).
type SavedElement = ElementInfo & { seen?: ElementContext | null };

// The <element> under each draft's pin, as its frame saw it when the comment
// was left. As last seen, where the frame couldn't say.
export const describeElements = (drafts: Comment[]): CommentContext[] =>
  drafts.map((c) => {
    const info = c.element as unknown as SavedElement | null;
    const seen = usableContext(info?.seen);
    return {
      id: c.id,
      element: info && (seen ? describeContext(seen) : describeLastSeen({ frame: c.componentName, info })),
      preview: frameUrl(c.componentName),
      // The frame's size, which the element's box is read at, as Inspect gives it.
      frame: seen?.viewport.join("×") ?? null,
    };
  });

// Sends the drafts to the chat that's open, or a new one if none is, as a
// chat message: the server writes the message (POST /comments/prompt), and
// it goes out through the composer's own send (useSendToChat), which marks
// them sent with it. Into the chat (and workspace) open when Send was
// pressed, which the message is written for, whatever is open by the time
// it's written. Resolves to the chat they went to.
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
      const context = describeElements(drafts);
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
      target: { workspaceId, conversationId: into ?? null },
      title: drafts.filter((c) => sent.has(c.id)).map((c) => c.text).join("\n"),
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.comments.byWorkspace(workspaceId) });
    return conversationId;
  };

  return { send, isPending: describing || sendToChat.isPending };
};

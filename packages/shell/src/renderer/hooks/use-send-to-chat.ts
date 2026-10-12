import { useQueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages, EffortLevel } from "@/main/api";
import type { ImageAttachment } from "@/shared/utils/message";
import { useCreateConversation, useGenerateTitle, useSendMessage } from "@/renderer/lib/claude-code-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import { retryStream } from "@/renderer/lib/stream-subscription";
import { useWorkspaceStore } from "@/renderer/store/workspace";

/**
 * Sends a prompt to the chat that's open, or a new one if none is: the
 * composer's send, and the canvas comments' (comments/CommentFlow). One send,
 * so both get the same optimistic bubble, queued/direct intent, rollback and
 * retry (sendMessageMutationOptions).
 *
 * `model`/`effort` are the caller's: the composer's un-sent picks live in its
 * own useComposerModel. `title` is what an untitled chat is named from.
 * `commentIds` are the drafts the prompt carries, which the backend marks
 * sent into the chat before the turn starts (POST /chat/message); `editIds`,
 * the design edits it applies, which it hands to the chat the same way.
 * `target` is where to send when the caller chose it before awaiting
 * something (the comments: their prompt is written for that chat), rather
 * than wherever is open by the time it sends; a null chat is a new one.
 */
export const useSendToChat = () => {
  const queryClient = useQueryClient();
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const generateTitle = useGenerateTitle();

  const send = async ({
    prompt,
    images,
    model,
    effort,
    title,
    commentIds,
    editIds,
    target,
  }: {
    prompt: string;
    images?: ImageAttachment[];
    model?: string;
    effort?: EffortLevel;
    title: string;
    commentIds?: number[];
    editIds?: number[];
    target?: { workspaceId: string; conversationId: string | null };
  }) => {
    const open = useWorkspaceStore.getState();
    const { showConversation } = open;
    const activeWorkspaceId = target ? target.workspaceId : open.activeWorkspaceId;
    const activeConversationId = target ? target.conversationId : open.activeConversationId;
    if (!activeWorkspaceId) return;

    const conversation = activeConversationId
      ? queryClient.getQueryData<ConversationWithMessages>(queryKeys.conversations.detail(activeConversationId))
      : undefined;
    // Read before retryStream, which writes "streaming" into the cache.
    const isStreaming = conversation?.streamStatus === "streaming";

    // Sending while disconnected would otherwise post into a conversation
    // nothing is watching: the owner effect is keyed on the conversation, and
    // that has not changed, so only this reopens the stream.
    if (conversation?.streamStatus === "error" && activeConversationId) {
      retryStream(activeConversationId, queryClient);
    }

    // Generate userMessageId for dedup
    const userMessageId = crypto.randomUUID();

    let conversationId = activeConversationId;

    if (!conversationId) {
      const conv = await createConversation.mutateAsync({
        workspaceId: activeWorkspaceId,
      });
      // Shown only in its workspace: one switched away from meanwhile keeps
      // the chat it's on.
      if (useWorkspaceStore.getState().activeWorkspaceId === activeWorkspaceId) showConversation(conv.id);
      conversationId = conv.id;
    }

    // The composer selection rides the message — the send is the only
    // moment options are set (persisted on the row and applied to the CLI).
    await sendMessage.mutateAsync({
      message: prompt,
      workspaceId: activeWorkspaceId,
      conversationId,
      userMessageId,
      images,
      model,
      effort,
      commentIds,
      editIds,
      sentMidTurn: isStreaming,
    });

    // Fire-and-forget title generation if conversation has no title/summary yet
    const needsTitle = !conversation?.title && !conversation?.summary;
    if (needsTitle) {
      generateTitle.mutate({
        conversationId,
        workspaceId: activeWorkspaceId,
        firstMessage: title,
      });
    }
    return conversationId;
  };

  return { send, isPending: createConversation.isPending || sendMessage.isPending };
};

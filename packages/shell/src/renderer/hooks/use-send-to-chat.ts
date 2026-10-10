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
 * sent into the chat before the turn starts (POST /chat/message).
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
  }: {
    prompt: string;
    images?: ImageAttachment[];
    model?: string;
    effort?: EffortLevel;
    title: string;
    commentIds?: number[];
  }) => {
    const { activeWorkspaceId, activeConversationId, showConversation } = useWorkspaceStore.getState();
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
      showConversation(conv.id);
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

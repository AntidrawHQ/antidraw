import type { ConversationWithMessages, Message } from "@/main/api";
import type { ImageAttachment } from "@/shared/utils/message";
import { createUserSDKMessage } from "@/shared/utils/message";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversation,
  getConversationWithMessages,
  listWorkspaceConversations,
  sendMessage,
} from "./api";
import { selectToolMap } from "./tool-utils";

// Shared query options for conversation data
const conversationQueryOptions = (conversationId: string) => ({
  queryKey: ["conversation", conversationId] as const,
  queryFn: async () => {
    const result = await getConversationWithMessages(conversationId);
    if (result.isErr()) {
      throw new Error(result.error.message);
    }
    return result.value;
  },
  staleTime: Infinity,
});

export const useConversationMessages = (conversationId: string | null) => {
  return useQuery({
    ...conversationQueryOptions(conversationId!),
    enabled: !!conversationId,
  });
};

export const useWorkspaceConversations = (workspaceId: string | null) => {
  return useQuery({
    queryKey: ["workspace-conversations", workspaceId] as const,
    queryFn: async () => {
      const result = await listWorkspaceConversations(workspaceId!);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    enabled: !!workspaceId,
  });
};

// Returns Map<string, ToolPart> for tool correlation
export const useToolMap = (conversationId: string | null) => {
  return useQuery({
    ...conversationQueryOptions(conversationId!),
    enabled: !!conversationId,
    select: selectToolMap,
  });
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const result = await createConversation(workspaceId);

      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return result.value;
    },
    onSuccess: (conversation) => {
      // Pre-populate cache with empty messages
      queryClient.setQueryData<ConversationWithMessages>(
        ["conversation", conversation.id],
        { ...conversation, messages: [] }
      );
    },
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      message: string;
      workspaceId: string;
      conversationId: string;
      images?: ImageAttachment[];
    }) => {
      const { message, workspaceId, conversationId, images } = params;

      const stream = sendMessage({
        message,
        workspaceId,
        conversationId,
        images,
      });

      for await (const response of stream) {
        if (response.type === "error") {
          throw new Error(response.message);
        }

        // Incrementally update cache with each streamed message
        queryClient.setQueryData<ConversationWithMessages>(
          ["conversation", conversationId],
          (prev) => {
            if (!prev) return prev;

            const newMessage: Message = {
              id: response.message.uuid ?? crypto.randomUUID(),
              conversationId,
              messageType: "sdk_message",
              sdkMessage: response.message,
              createdAt: new Date(),
            };

            return {
              ...prev,
              messages: [...prev.messages, newMessage],
            };
          }
        );
      }
    },

    onMutate: async ({ message, conversationId, images }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: ["conversation", conversationId],
      });

      const previousChat = queryClient.getQueryData<ConversationWithMessages>([
        "conversation",
        conversationId,
      ]);

      if (!previousChat) {
        // This shouldn't happen if the flow is correct:
        // - New conversation: useCreateConversation sets cache in onSuccess
        // - Existing conversation: useConversationMessages fetches and caches
        throw new Error("Conversation not found in cache");
      }

      // Optimistically add user message
      const sdkMessage = createUserSDKMessage({
        text: message,
        sessionId: previousChat.claudeCodeSessionId ?? "",
        uuid: crypto.randomUUID(),
        images,
      });

      const optimisticUserMessage: Message = {
        id: crypto.randomUUID(),
        conversationId,
        messageType: "user_prompt",
        sdkMessage,
        createdAt: new Date(),
      };

      queryClient.setQueryData<ConversationWithMessages>(
        ["conversation", conversationId],
        {
          ...previousChat,
          messages: [...previousChat.messages, optimisticUserMessage],
        }
      );

      return { previousChat };
    },

    onError: (_err, { conversationId }, context) => {
      if (context?.previousChat) {
        queryClient.setQueryData(
          ["conversation", conversationId],
          context.previousChat
        );
      }
    },
  });
};

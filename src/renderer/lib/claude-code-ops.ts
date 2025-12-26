import type { ConversationWithMessages, Message } from "@/main/api";
import { createUserSDKMessage } from "@/shared/utils/message";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversation,
  getConversationWithMessages,
  sendMessage,
} from "./api";

export const useConversationMessages = (conversationId: string) => {
  return useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      const result = await getConversationWithMessages(conversationId);

      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return result.value;
    },
  });
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await createConversation();

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
    mutationFn: async (params: { message: string; conversationId: string }) => {
      const { message, conversationId } = params;

      const stream = sendMessage({
        message,
        conversationId,
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

    onMutate: async ({ message, conversationId }) => {
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

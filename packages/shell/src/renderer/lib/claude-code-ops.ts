import type { Conversation, ConversationWithMessages, Message } from "@/main/api";
import { createUserSDKMessage } from "@/shared/utils/message";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversation,
  generateConversationTitle,
  getConversationWithMessages,
  listWorkspaceConversations,
  sendMessage,
  subscribeToConversation,
  type StreamEvent,
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

// Hook that subscribes to stream events when conversation is streaming
export const useConversationWithStream = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  // Main data query
  const query = useQuery({
    ...conversationQueryOptions(conversationId!),
    enabled: !!conversationId,
  });

  // @CLAUDE-CODE: will this reactively update ? wont this be stale ? 
  const isStreaming = query.data?.streamStatus === "streaming";

  // Stream subscription as a query (not useEffect!)
  useQuery({
    queryKey: ["conversation-stream", conversationId],
    queryFn: async () => {
      const stream = subscribeToConversation(conversationId!);

      for await (const event of stream) {
        if (event.type === "message") {
          queryClient.setQueryData<ConversationWithMessages>(
            ["conversation", conversationId],
            (old) => {
              if (!old) return old;
              // Dedup by ID - works because frontend generates userMessageId
              if (old.messages.some((m) => m.id === event.message.id))
                return old;
              return { ...old, messages: [...old.messages, event.message] };
            },
          );
        }

        if (event.type === "complete") {
          queryClient.setQueryData<ConversationWithMessages>(
            ["conversation", conversationId],
            (old) => (old ? { ...old, streamStatus: "completed" } : old),
          );
          return { status: "complete" as const };
        }

        if (event.type === "cancelled") {
          queryClient.setQueryData<ConversationWithMessages>(
            ["conversation", conversationId],
            (old) => (old ? { ...old, streamStatus: "cancelled" } : old),
          );
          return { status: "cancelled" as const };
        }

        if (event.type === "error") {
          queryClient.setQueryData<ConversationWithMessages>(
            ["conversation", conversationId],
            (old) => (old ? { ...old, streamStatus: "error" } : old),
          );
          return { status: "error" as const };
        }
      }

      return { status: "complete" as const };
    },
    enabled: !!conversationId && isStreaming,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  return query;
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
        { ...conversation, messages: [] },
      );
      // Add to workspace conversations list
      queryClient.setQueryData<Conversation[]>(
        ["workspace-conversations", conversation.workspaceId],
        (old) => (old ? [conversation, ...old] : [conversation]),
      );
    },
  });
};

// Send mutation with optimistic update
export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      message: string;
      workspaceId: string;
      conversationId: string;
      userMessageId: string; // Frontend generates this
    }) => {
      const result = await sendMessage(params);

      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return result.value;
    },

    onMutate: async ({ message, conversationId, userMessageId }) => {
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

      // Optimistic user message with same ID backend will use
      const sdkMessage = createUserSDKMessage({
        text: message,
        sessionId: previousChat.claudeCodeSessionId ?? "",
        uuid: userMessageId as `${string}-${string}-${string}-${string}-${string}`,
      });

      const userMessage: Message = {
        id: userMessageId, // Same ID sent to backend - dedup works!
        conversationId,
        messageType: "user_prompt",
        sdkMessage,
        createdAt: new Date(),
      };

      queryClient.setQueryData<ConversationWithMessages>(
        ["conversation", conversationId],
        {
          ...previousChat,
          streamStatus: "streaming",
          messages: [...previousChat.messages, userMessage],
        },
      );

      return { previousChat };
    },

    onError: (_err, { conversationId }, context) => {
      if (context?.previousChat) {
        queryClient.setQueryData(
          ["conversation", conversationId],
          context.previousChat,
        );
      }
    },
  });
};

export const useGenerateTitle = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      firstMessage,
    }: {
      conversationId: string;
      firstMessage: string;
      workspaceId: string;
    }) => {
      const result = await generateConversationTitle(conversationId, firstMessage);

      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return result.value;
    },
    onSuccess: (data, { conversationId, workspaceId }) => {
      // Update conversation cache
      queryClient.setQueryData<ConversationWithMessages>(
        ["conversation", conversationId],
        (old) => (old ? { ...old, title: data.title, summary: data.summary } : old)
      );
      // Update sidebar list
      queryClient.setQueryData<Conversation[]>(
        ["workspace-conversations", workspaceId],
        (old) =>
          old?.map((c) =>
            c.id === conversationId
              ? { ...c, title: data.title, summary: data.summary }
              : c
          )
      );
    },
  });
};


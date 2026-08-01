import type {
  Conversation,
  ConversationWithMessages,
  EffortLevel,
  Message,
} from "@/main/api";
import type { ImageAttachment } from "@/shared/utils/message";
import { createUserSDKMessage } from "@/shared/utils/message";
import { queryOptions, useMutation, useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ToolPart } from "@/renderer/components/ui/tool";
import { queryKeys } from "./query-keys";
import {
  cancelConversationStream,
  createConversation,
  generateConversationTitle,
  getConversationWithMessages,
  listWorkspaceConversations,
  sendMessage,
} from "./api";
import { subscribeToStream, type LivePartial } from "./stream-subscription";
import { selectToolMap } from "./tool-utils";

// Shared query options for conversation data
const conversationQueryOpts = (conversationId: string | null) =>
  queryOptions({
    queryKey: queryKeys.conversations.detail(conversationId),
    queryFn: conversationId
      ? async () => {
          const result = await getConversationWithMessages(conversationId);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }
          return result.value;
        }
      : skipToken,
    staleTime: Infinity,
  });

export const useConversationMessages = (conversationId: string | null) => {
  return useQuery(conversationQueryOpts(conversationId));
};

// Hook that subscribes to stream events when conversation is streaming
export const useConversationWithStream = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  // Main data query
  const query = useQuery(conversationQueryOpts(conversationId));

  const isStreaming = query.data?.streamStatus === "streaming";

  // SSE subscription - fire and forget, runs until server terminates
  useEffect(() => {
    if (!conversationId || !isStreaming) return;
    subscribeToStream(conversationId, queryClient);
    // No cleanup - subscription runs until server sends terminal event
  }, [conversationId, isStreaming, queryClient]);

  return query;
};

export const useWorkspaceConversations = (workspaceId: string | null) => {
  return useQuery({
    queryKey: queryKeys.conversations.byWorkspace(workspaceId),
    queryFn: workspaceId
      ? async () => {
          const result = await listWorkspaceConversations(workspaceId);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }
          return result.value;
        }
      : skipToken,
  });
};

// Returns Map<string, ToolPart> for tool correlation, including the in-flight tool_use
// block (if any) merged with state: "input-streaming".
export const useToolMap = (conversationId: string | null) => {
  const conversation = useQuery(conversationQueryOpts(conversationId));
  const { data: live } = useLivePartial(conversationId);

  const data = useMemo<Map<string, ToolPart>>(() => {
    if (!conversation.data) return new Map();
    return selectToolMap(conversation.data, live);
  }, [conversation.data, live]);

  return { data };
};

// Reads the live in-flight content block from the cache.
// Populated imperatively by stream-subscription's reducer; queryFn is a noop.
export const useLivePartial = (conversationId: string | null) => {
  return useQuery<LivePartial>({
    queryKey: queryKeys.conversations.livePartial(conversationId),
    queryFn: () => null,
    enabled: false,
    initialData: null as LivePartial,
    staleTime: Infinity,
  });
};

// Reads the CLI's authoritative effort echo for the conversation.
// Populated imperatively by stream-subscription; queryFn is a noop.
export const useActualEffort = (conversationId: string | null) => {
  return useQuery<string | null>({
    queryKey: queryKeys.conversations.actualEffort(conversationId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
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
        queryKeys.conversations.detail(conversation.id),
        { ...conversation, messages: [] },
      );
      // Add to workspace conversations list
      queryClient.setQueryData<Conversation[]>(
        queryKeys.conversations.byWorkspace(conversation.workspaceId),
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
      images?: ImageAttachment[];
      model?: string;
      effort?: EffortLevel;
    }) => {
      const result = await sendMessage(params);

      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return result.value;
    },

onMutate: async ({ message, conversationId, userMessageId, images }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.conversations.detail(conversationId),
      });

      const previousChat = queryClient.getQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(conversationId),
      );

      if (!previousChat) {
        // This shouldn't happen if the flow is correct:
        // - New conversation: useCreateConversation sets cache in onSuccess
        // - Existing conversation: useConversationMessages fetches and caches
        throw new Error("Conversation not found in cache");
      }

      // Optimistic user message with same ID backend will use
      const sdkMessage = createUserSDKMessage({
        text: message,
        uuid: userMessageId as `${string}-${string}-${string}-${string}-${string}`,
        images,
      });

      const userMessage: Message = {
        id: userMessageId, // Same ID sent to backend - dedup works!
        conversationId,
        messageType: "user_prompt",
        sdkMessage,
        createdAt: new Date(),
      };

      queryClient.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(conversationId),
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
          queryKeys.conversations.detail(conversationId),
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
        queryKeys.conversations.detail(conversationId),
        (old) => (old ? { ...old, title: data.title, summary: data.summary } : old)
      );
      // Update sidebar list
      queryClient.setQueryData<Conversation[]>(
        queryKeys.conversations.byWorkspace(workspaceId),
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

export const useCancelStream = () => {
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const result = await cancelConversationStream(conversationId);

      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return result.value;
    },
    // No cache updates needed - SSE handler will receive "complete" event
  });
};

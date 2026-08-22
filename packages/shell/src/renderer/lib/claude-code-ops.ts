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
  cancelQueuedMessage,
  createConversation,
  generateConversationTitle,
  getConversationWithMessages,
  getSupportedModels,
  listWorkspaceConversations,
  sendMessage,
} from "./api";
import { DEFAULT_MODELS } from "@/renderer/components/modelPickerShared";
import {
  SEND_MESSAGE_MUTATION_KEY,
  subscribeToStream,
  type LivePartial,
} from "./stream-subscription";
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

// The CLI's live model catalog. One fetch per session, cached forever:
// the catalog is pinned to the bundled CLI binary, which can only change
// across an app update/restart (main also caches it for the session, so a
// refetch would be a no-op anyway). DEFAULT_MODELS covers the gap while the
// first fetch resolves — and remains the working set if it fails, since
// placeholderData is returned whenever the cache is empty.
export const useSupportedModels = () => {
  return useQuery({
    queryKey: queryKeys.models.catalog,
    queryFn: async () => {
      const result = await getSupportedModels();
      if (result.isErr()) throw new Error(result.error.message);
      return result.value;
    },
    staleTime: Infinity,
    placeholderData: DEFAULT_MODELS,
  });
};

// userMessageIds sent while a turn was in flight and not yet acked by the
// CLI (message_accepted). Renderer-only cache state: populated by
// useSendMessage, drained by stream-subscription (ack / complete / error)
// and useCancelQueuedMessage. Nothing is persisted; a refetch clears it.
export const useQueuedMessageIds = (conversationId: string | null) => {
  return useQuery<string[]>({
    queryKey: queryKeys.conversations.queuedMessageIds(conversationId),
    queryFn: () => [],
    enabled: false,
    initialData: [],
    staleTime: Infinity,
  });
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { workspaceId: string }) => {
      const result = await createConversation(params.workspaceId);

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
    mutationKey: [SEND_MESSAGE_MUTATION_KEY],
    mutationFn: async (params: {
      message: string;
      workspaceId: string;
      conversationId: string;
      userMessageId: string; // Frontend generates this
      images?: ImageAttachment[];
      // Composer selection snapshot — rides the message; the only way
      // options are ever set.
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

      // Sent mid-turn: the CLI queues it. Mark it until the ack
      // (message_accepted) says it has entered a turn.
      if (previousChat.streamStatus === "streaming") {
        queryClient.setQueryData<string[]>(
          queryKeys.conversations.queuedMessageIds(conversationId),
          (prev) => [...(prev ?? []), userMessageId],
        );
      }

      queryClient.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(conversationId),
        {
          ...previousChat,
          streamStatus: "streaming",
          messages: [...previousChat.messages, userMessage],
        },
      );

      return { previousChat, optimisticMessage: userMessage };
    },

    // The 202 means the backend has claimed the slot and registered this
    // send. The backend does not write streamStatus on send any more (the
    // CLI's `running` does, a moment later), so until then the row says
    // whatever it said before. Two things must hold regardless of what a
    // crossing `complete` + refetch may have done in between: the cache
    // says streaming (shimmer, Stop, and the subscribe effect), and the SSE
    // subscription is open so the CLI's `streaming`/`queue_state`/ack
    // events for this send are observed. subscribeToStream is idempotent.
    onSuccess: (_data, { conversationId, userMessageId }, context) => {
      queryClient.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(conversationId),
        (old) => {
          if (!old) return old;
          const optimistic = context?.optimisticMessage;
          const hasBubble = old.messages.some((m) => m.id === userMessageId);
          return {
            ...old,
            streamStatus: "streaming",
            messages:
              hasBubble || !optimistic
                ? old.messages
                : [...old.messages, optimistic],
          };
        },
      );
      subscribeToStream(conversationId, queryClient);
    },

    onError: (_err, { conversationId, userMessageId }, context) => {
      if (context?.previousChat) {
        queryClient.setQueryData(
          queryKeys.conversations.detail(conversationId),
          context.previousChat,
        );
      }
      queryClient.setQueryData<string[]>(
        queryKeys.conversations.queuedMessageIds(conversationId),
        (prev) => prev?.filter((id) => id !== userMessageId) ?? [],
      );
    },
  });
};

// Withdraw a queued message. The backend relays the CLI's verdict:
// cancelled=true → it never runs; drop the optimistic bubble and the mark.
// cancelled=false → it already entered a turn (ack imminent) or never
// reached the CLI; it will run, so keep the bubble and drop only the mark.
export const useCancelQueuedMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      userMessageId,
    }: {
      conversationId: string;
      userMessageId: string;
    }) => {
      const result = await cancelQueuedMessage(conversationId, userMessageId);
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    onSuccess: ({ cancelled }, { conversationId, userMessageId }) => {
      queryClient.setQueryData<string[]>(
        queryKeys.conversations.queuedMessageIds(conversationId),
        (prev) => prev?.filter((id) => id !== userMessageId) ?? [],
      );
      if (!cancelled) return;
      queryClient.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(conversationId),
        (old) =>
          old
            ? {
                ...old,
                messages: old.messages.filter((m) => m.id !== userMessageId),
              }
            : old,
      );
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

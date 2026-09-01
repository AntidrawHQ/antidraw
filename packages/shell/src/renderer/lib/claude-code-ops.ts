import type {
  Conversation,
  ConversationWithMessages,
  EffortLevel,
  Message,
} from "@/main/api";
import type { ImageAttachment } from "@/shared/utils/message";
import { createUserSDKMessage } from "@/shared/utils/message";
import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useWorkspaceStore } from "@/renderer/store/workspace";
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
  PENDING_SEQ,
  SEND_MESSAGE_MUTATION_KEY,
  releaseStream,
  subscribeToStream,
  type LivePartial,
} from "./stream-subscription";
import { selectToolMap } from "./tool-utils";

// Shared query options for conversation data. Exported so a test can build an
// observer from the real thing: a hand-written mirror would pin its own copy of
// staleTime and the queryFn shape, and go on passing after production changed.
export const conversationQueryOpts = (conversationId: string | null) =>
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

// Owns the subscription for whichever conversation is open. Mounted once, at
// the app root, because that is the only place with the right lifetime: the
// subscription belongs to the open conversation, and no component that renders
// the conversation lives exactly that long. AppChat is the cautionary case —
// opening the conversation list or switching to the Components panel unmounts
// it while the very same conversation is still open, and an owner that lets go
// there drops a subscription on a conversation the user is still in.
export const useConversationSubscription = () => {
  const conversationId = useWorkspaceStore((s) => s.activeConversationId);
  const queryClient = useQueryClient();

  // One effect, because acquiring and releasing now share a lifetime: this is
  // held because the conversation is open, not because a turn is running in
  // it. Gating acquisition on streamStatus was the asymmetry — release ran on
  // any close, but re-acquisition asked a status that is allowed to lie. The
  // CLI reports idle while a message we handed it is still un-acked, so a
  // conversation can read idle with its events still coming; a gate reading
  // that declines to re-watch it, and with staleTime Infinity nothing refetches
  // to correct the answer. Unconditional here, the status stops being an input
  // at all, and the backend's `state` seed on attach is what fixes one that
  // went stale while away.
  //
  // Re-attaching costs only what the gap contained, since the stream resumes
  // from a cursor.
  useEffect(() => {
    if (!conversationId) return;
    subscribeToStream(conversationId, queryClient);
    return () => releaseStream(conversationId);
  }, [conversationId, queryClient]);
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
  return useQuery<LivePartial | null>({
    queryKey: queryKeys.conversations.livePartial(conversationId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
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

// userMessageIds the backend has handed the CLI but the CLI has not acked.
// Mirror-only: the sole writer is stream-subscription applying the backend's
// `queue` snapshots. Nothing is persisted; a refetch clears it.
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

// Re-exported from its definition next to the cursor that has to skip it.
export { PENDING_SEQ } from "./stream-subscription";

// Send mutation with optimistic update
// The send's whole optimistic protocol, lifted out of the hook so it can be
// executed without a renderer. Mirrors conversationQueryOpts above: the hook
// becomes the React binding, and the behaviour is a plain value that a test
// can build and run through the mutation cache.
export const sendMessageMutationOptions = (queryClient: QueryClient) =>
  mutationOptions({
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
        seq: PENDING_SEQ,
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

      return { previousChat, optimisticMessage: userMessage };
    },

    // The 202 means the backend has claimed the slot and registered this
    // send. The backend does not write streamStatus on send any more (the
    // CLI's `running` does, a moment later), so until then the row says
    // whatever it said before. Re-asserting streaming here restores what a
    // crossing `complete` + refetch may have undone, so the shimmer and Stop
    // survive it. It no longer has anything to do with subscribing: the
    // subscription is held for whichever conversation is open, so one is
    // already running before this send was made. Opening one from here would
    // also be wrong — it could acquire a subscription for a conversation that
    // is no longer open, which nothing would then release.
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

export const useSendMessage = () =>
  useMutation(sendMessageMutationOptions(useQueryClient()));

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

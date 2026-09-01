import type { UUID } from "node:crypto";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Conversation } from "./models/chat.model";
import type { ImageAttachment } from "@/shared/utils/message";
import {
  sendMessage,
  buildPrompt,
  type EffortLevel,
  type PromptStream,
} from "@/main/api/claude-code-ops";
import {
  addMessage,
  updateConversationSession,
  convertUserPromptToSDKMessage,
  setConversationOptions,
} from "./services/chat.service";
import {
  conversationEvents,
  openHandle,
  getHandle,
  attachQuery,
  releaseHandle,
  markError,
  setCliState,
  addPending,
  applyPartial,
  clearPartial,
  resolvePending,
  clearPending,
  type CliHandle,
} from "@/main/lib/conversation-store";
import { trackMessageSent } from "@/main/lib/posthog";

export const handleSdkMessageWithoutPersisting = (
  conversationId: string,
  sdkMessage: SDKMessage,
): boolean => {
  if (sdkMessage.type === "stream_event") {
    applyPartial(conversationId, sdkMessage);
    conversationEvents.emit("partial", conversationId, { partial: sdkMessage });
    return true;
  }

  if (
    sdkMessage.type === "system" &&
    sdkMessage.subtype === "session_state_changed"
  ) {
    setCliState(conversationId, sdkMessage.state);
    return true;
  }

  if (
    sdkMessage.type === "user" &&
    "isReplay" in sdkMessage &&
    sdkMessage.isReplay
  ) {
    resolvePending(conversationId, sdkMessage.uuid);
    return true;
  }

  return false;
};

export const handleAndPersistSdkMessage = async (
  ctx: { conversation: Conversation; sessionId: string | undefined },
  sdkMessage: SDKMessage,
): Promise<void> => {
  if (
    !ctx.sessionId &&
    sdkMessage.type === "system" &&
    sdkMessage.subtype === "init" &&
    sdkMessage.session_id
  ) {
    ctx.sessionId = sdkMessage.session_id;
    await updateConversationSession(ctx.conversation.id, sdkMessage.session_id);
  }

  await addMessage({
    conversationId: ctx.conversation.id,
    messageType: "sdk_message",
    sdkMessage,
  });

  // The persisted message supersedes the block that was streaming into it.
  // Blocks stream serially, so there is only ever the one to drop.
  if (sdkMessage.type === "assistant") {
    clearPartial(ctx.conversation.id);
  }
};

export type TurnRequest = {
  conversation: Conversation;
  workspaceId: string;
  message: string;
  userMessageId: string;
  images?: ImageAttachment[];
  options?: { model?: string; effort?: EffortLevel };
};

const pushFollowUpTurn = async (
  req: TurnRequest,
  handle: CliHandle,
): Promise<void> => {
  const { conversation, message, userMessageId, images, options } = req;
  try {
    if (handle.query) {
      try {
        await handle.query.setModel(options?.model ?? undefined);
        await handle.query.applyFlagSettings({
          effortLevel: (options?.effort ?? null) as Exclude<
            EffortLevel,
            "max"
          > | null,
        });
      } catch (e) {
        console.error("Pre-push option apply failed; applies next cold start:", e);
      }
    }

    const pushed = handle.promptStream.push(message, {
      uuid: userMessageId as UUID,
      images,
    });
    if (pushed.isErr()) {
      console.error("Failed to push follow-up turn:", pushed.error);
      resolvePending(conversation.id, userMessageId);
      return;
    }
  } catch (e) {
    console.error("Unexpected error on the push path:", e);
    resolvePending(conversation.id, userMessageId);
    return;
  }
  if (handle.query) trackMessageSent({ query: handle.query });
};

const runColdStart = async (
  req: TurnRequest,
  promptStream: PromptStream,
): Promise<void> => {
  const { conversation, workspaceId, options } = req;
  try {
    const claudeCodeSessionID = conversation.claudeCodeSessionId ?? undefined;

    const res = sendMessage({
      promptStream,
      workspaceId,
      claudeCodeSessionID,
      model: options?.model,
      effort: options?.effort,
      onEffortLevel: (level) =>
        conversationEvents.emit("effort", conversation.id, { level }),
    });

    if (res.isErr()) {
      throw new Error("Failed to init Claude Code");
    }

    attachQuery(conversation.id, res.value);
    trackMessageSent({ query: res.value });

    const ctx = { conversation, sessionId: claudeCodeSessionID };

    for await (const sdkMessage of res.value) {
      if (handleSdkMessageWithoutPersisting(conversation.id, sdkMessage)) {
        continue;
      }
      await handleAndPersistSdkMessage(ctx, sdkMessage);
    }

    setCliState(conversation.id, "idle");
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    markError(conversation.id);
    conversationEvents.emit("error", conversation.id, { error: errorMessage });
  } finally {
    clearPending(conversation.id);
    releaseHandle(conversation.id);
  }
};

export const runTurn = async (req: TurnRequest): Promise<void> => {
  const { conversation, message, userMessageId, images, options } = req;

  const promptStream = buildPrompt(message, {
    uuid: userMessageId as UUID,
    images,
  });
  const turnType = openHandle(conversation.id, promptStream);
  const handle = getHandle(conversation.id)!;
  // The cold-start prompt is the spawn prompt — the CLI reports `running`
  // for it before anything else, so it is never "queued". Only a follow-up
  // waits on an ack.
  if (turnType === "follow-up") addPending(conversation.id, userMessageId);

  const persisted = await setConversationOptions(conversation.id, {
    selectedModel: options?.model ?? null,
    ...(options?.effort !== undefined ? { selectedEffort: options.effort } : {}),
  });
  if (persisted.isErr()) {
    console.error("Failed to persist options snapshot:", persisted.error);
  }

  const recorded = await addMessage({
    id: userMessageId,
    conversationId: conversation.id,
    messageType: "user_prompt",
    sdkMessage: convertUserPromptToSDKMessage(
      message,
      userMessageId as UUID,
      images,
    ),
  });
  if (recorded.isErr()) {
    console.error("Failed to persist the user prompt:", recorded.error);
    if (turnType === "cold-start") {
      clearPending(conversation.id);
      releaseHandle(conversation.id);
    } else {
      resolvePending(conversation.id, userMessageId);
    }
    return;
  }

  return turnType === "cold-start"
    ? runColdStart(req, promptStream)
    : pushFollowUpTurn(req, handle);
};

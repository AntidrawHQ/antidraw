import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/renderer/components/ui/chat-container";
import {
  FileUpload,
  FileUploadContent,
  FileUploadTrigger,
} from "@/renderer/components/ui/file-upload";
import { Markdown } from "@/renderer/components/ui/markdown";
import { Message, MessageContent } from "@/renderer/components/ui/message";
import { MessageShimmer } from "@/renderer/components/ui/message-shimmer";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/renderer/components/ui/prompt-input";
import { Button } from "@/renderer/components/ui/button";
import { cn } from "@/renderer/lib/utils";
import { triggerClaudeLogin } from "@/renderer/lib/api";
import { ArrowUp, ImageIcon, Paperclip, Square, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages } from "@/main/api";
import { retryStream } from "./lib/stream-subscription";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useCancelStream,
  useConversationMessages,
  useCreateConversation,
  useFailedMessageIds,
  useGenerateTitle,
  useLivePartial,
  useQueuedMessageIds,
  useSendMessage,
  useToolMap,
} from "./lib/claude-code-ops";
import { Tool } from "@/renderer/components/ui/tool";
import type { ToolPart } from "@/renderer/components/ui/tool";
import { liveToolPart, viewableComponent } from "./lib/tool-utils";
import { AuthError } from "@/renderer/components/auth-error";
import { StreamError } from "@/renderer/components/stream-error";
import { useWorkspaceStore } from "./store/workspace";
import { useUserComponents } from "./store/userComponents";
import { ChatEmptyState } from "./components/ChatEmptyState";
import ModelPicker from "@/renderer/components/ModelPicker";
import EffortDropdown from "@/renderer/components/EffortDropdown";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { QueuedMessagesDeck } from "@/renderer/components/QueuedMessagesDeck";
import { useQueueDeck } from "@/renderer/lib/use-queue-deck";
import { SMOOTH } from "@/renderer/lib/motion";
import { SentTags, TagChips } from "@/renderer/inspector/TagChips";
import { describePendingTags, retagTags, splitTagged, untagTags } from "@/renderer/inspector/tags";
import {
  SUPPORTED_IMAGE_TYPES,
  type ImageAttachment,
  type SupportedImageMediaType,
} from "@/shared/utils/message";

type Base64ImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: SupportedImageMediaType;
    data: string;
  };
};

type ChatMessage = ConversationWithMessages["messages"][number];

// The tool_use ids a message renders, in the order it renders them.
const toolUseIds = (msg: ChatMessage): string[] => {
  const sdkMessage = msg.sdkMessage;
  if (sdkMessage.type !== "user" && sdkMessage.type !== "assistant") return [];
  const content = sdkMessage.message.content;
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (block.type === "tool_use") ids.push(block.id);
  }
  return ids;
};

// A base64 data URL is rebuilt by concatenation, which makes a new multi-MB
// string every time it is asked for; React then compares it against the last
// one. Built once per block instead.
const imageSrcs = new WeakMap<object, string>();
const imageSrc = (block: Base64ImageBlock): string => {
  let src = imageSrcs.get(block);
  if (src === undefined) {
    src = `data:${block.source.media_type};base64,${block.source.data}`;
    imageSrcs.set(block, src);
  }
  return src;
};

const NO_TOOLS: readonly (ToolPart | undefined)[] = [];

// A row's own tools, one per tool_use block in order. Handed over instead of
// the whole map: a memoized row keeps the props of its last real render, so
// each row holding the map would keep every generation of it alive.
const rowTools = (
  msg: ChatMessage,
  toolMap: ReadonlyMap<string, ToolPart>,
): readonly (ToolPart | undefined)[] => {
  const ids = toolUseIds(msg);
  return ids.length ? ids.map((id) => toolMap.get(id)) : NO_TOOLS;
};

type ViewComponent = (componentName: string) => void;
const NO_VIEWS: readonly (ViewComponent | undefined)[] = [];

// A tool-call row. The list's gap-2 plus my-1 puts 12px between a burst of
// calls and prose; between consecutive tool rows -mt-3 cancels the gap and
// both margins, so their groups touch.
const TOOL_ROW = "my-1 [[data-kind=tool]+&[data-kind=tool]]:-mt-3";

// One burst of calls in one outlined card, divided by hairlines ("Grouped
// list" with the faint border, from the ToolCallsMono design). A burst
// usually spans several rows, one call each, so touching groups join in CSS
// instead of being regrouped in React, which would undo the row memos: the
// upper loses its bottom edge and corners, the lower's top edge becomes the
// divider. `group` is each row's wrapper: Message > div > group.
const TOOL_GROUP = cn(
  "overflow-hidden rounded-md border border-white/[0.05] divide-y divide-white/[0.06]",
  "[[data-kind=tool]:has(+[data-kind=tool])>div>&]:rounded-b-none [[data-kind=tool]:has(+[data-kind=tool])>div>&]:border-b-0",
  "[[data-kind=tool]+[data-kind=tool]>div>&]:rounded-t-none [[data-kind=tool]+[data-kind=tool]>div>&]:border-t-white/[0.06]"
);

type MessageRowProps = {
  msg: ChatMessage;
  // Parallel to the message's tool_use blocks (see rowTools).
  tools: readonly (ToolPart | undefined)[];
  // Parallel to `tools`: each tool's View handler, or undefined when it has
  // no component on the canvas. Per tool rather than one handler for the
  // list, so a component appearing re-renders only the rows that show it.
  views: readonly (ViewComponent | undefined)[];
  // Persisted, never acked, and no live handle holds it: the CLI never
  // received this prompt. The backend decides (see useFailedMessageIds);
  // a live queued mark wins over a list that has not been refetched.
  isFailed: boolean;
  // The deck handed this prompt over this session: play its entrance.
  revealed: boolean;
  onSignIn: () => void;
  onRetry: () => void;
};

// A row re-renders only when its own message, or a tool it shows, changed.
// The transcript is the long part of a long session, and a new message at the
// bottom has no business re-rendering the thousand above it.
const rowPropsEqual = (a: MessageRowProps, b: MessageRowProps): boolean =>
  a.msg === b.msg &&
  a.isFailed === b.isFailed &&
  a.revealed === b.revealed &&
  a.onSignIn === b.onSignIn &&
  a.onRetry === b.onRetry &&
  a.tools.length === b.tools.length &&
  a.tools.every((tool, i) => tool === b.tools[i]) &&
  a.views.length === b.views.length &&
  a.views.every((view, i) => view === b.views[i]);

const MessageRow = memo(
  ({ msg, tools, views, isFailed, revealed, onSignIn, onRetry }: MessageRowProps) => {
    const sdkMessage = msg.sdkMessage;
    if (sdkMessage.type !== "user" && sdkMessage.type !== "assistant") {
      return null;
    }

    if (
      sdkMessage.type === "assistant" &&
      "error" in sdkMessage &&
      sdkMessage.error === "authentication_failed"
    ) {
      return <AuthError onSignIn={onSignIn} onRetry={onRetry} />;
    }

    const isAssistant = sdkMessage.type === "assistant";
    const content = sdkMessage.message.content;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === "string"
        ? [{ type: "text" as const, text: content }]
        : [];

    const imageBlocks = blocks.filter(
      (b): b is Base64ImageBlock =>
        b.type === "image" && "source" in b && b.source?.type === "base64"
    );

    const hasRenderableBlock = blocks.some(
      (b) => b.type === "text" || b.type === "tool_use" || b.type === "image"
    );
    if (!hasRenderableBlock) {
      return null;
    }

    const kind = blocks.some((b) => b.type === "text")
      ? "text"
      : blocks.some((b) => b.type === "tool_use" || b.type === "tool_result")
        ? "tool"
        : "text";

    // Text in order, with each run of consecutive tool calls in one group.
    const renderBlocks = () => {
      const nodes: ReactNode[] = [];
      let run: ReactNode[] = [];
      // Walks `tools` alongside the tool_use blocks.
      let toolIndex = 0;
      const flush = () => {
        if (run.length === 0) return;
        nodes.push(
          <div key={`tools-${nodes.length}`} className={TOOL_GROUP}>
            {run}
          </div>
        );
        run = [];
      };

      blocks.forEach((block, idx) => {
        if (block.type === "tool_use") {
          const toolPart = tools[toolIndex];
          const onViewComponent = views[toolIndex];
          toolIndex++;
          if (toolPart) {
            run.push(
              <Tool
                key={idx}
                toolPart={toolPart}
                onViewComponent={onViewComponent}
              />
            );
          }
          return;
        }

        if (block.type !== "text") return;
        flush();
        // Elements tagged on the canvas lead a user's message as markup for
        // the agent; the bubble shows them as chips.
        const tagged = isAssistant ? null : splitTagged(block.text);
        if (tagged?.tags.length) nodes.push(<SentTags key={`tags-${idx}`} tags={tagged.tags} />);
        nodes.push(
          isAssistant ? (
            <Markdown
              key={idx}
              className="bg-transparent text-foreground prose prose-sm prose-invert max-w-none rounded-lg"
            >
              {block.text}
            </Markdown>
          ) : (
            <MessageContent
              key={idx}
              className={cn(
                // Hugs its text up to 85% of the panel, against the right
                // edge, like the queued deck that hands prompts over.
                "self-end max-w-[85%] bg-neutral-700 text-neutral-200 prose prose-sm prose-invert",
                isFailed && "opacity-60"
              )}
            >
              {tagged ? tagged.text : block.text}
            </MessageContent>
          )
        );
      });
      flush();
      return nodes;
    };

    return (
      <Message
        data-role={isAssistant ? "assistant" : "user"}
        data-kind={kind}
        className={cn(
          isAssistant ? "justify-start" : "justify-end",
          kind === "tool" && TOOL_ROW,
          revealed && cn("animate-in fade-in slide-in-from-bottom-2", SMOOTH)
        )}
      >
        <div className="flex flex-col overflow-auto w-full">
          {imageBlocks.length > 0 && (
            <div className={cn("flex flex-wrap gap-1", !isAssistant && "justify-end")}>
              {imageBlocks.map((block, idx) => (
                <img
                  key={`img-${idx}`}
                  src={imageSrc(block)}
                  alt="Attached image"
                  className="h-10 w-10 rounded object-cover border border-neutral-600"
                />
              ))}
            </div>
          )}
          {renderBlocks()}
          {isFailed && (
            <div className="mt-0.5 self-end text-[10px] text-red-400">
              Not delivered
            </div>
          )}
        </div>
      </Message>
    );
  },
  rowPropsEqual
);
MessageRow.displayName = "MessageRow";

type LiveTailProps = {
  conversationId: string | null;
  // The persisted tools: a live tool_use already in here has been persisted,
  // and the row above shows it.
  toolMap: ReadonlyMap<string, ToolPart>;
  isStreaming: boolean;
};

// The block being produced right now. It is the only part of the transcript
// that changes on every frame of a stream, so it is the only part that reads
// the live partial: subscribed from the list, each token re-rendered every
// row above it.
//
// Renders a fragment so its children stay direct children of the list's flex
// column — spacing and the tool-adjacency selector on rows depend on it.
const LiveTail = memo(({ conversationId, toolMap, isStreaming }: LiveTailProps) => {
  const { data: live } = useLivePartial(conversationId);

  const liveText =
    live?.block.type === "text" && live.block.text.length > 0
      ? live.block.text
      : null;

  // For tool_use, the list's normal flow can't render the in-flight block —
  // it only iterates persisted message content. Synthesize a Tool from the
  // block (state: "input-streaming") and render it after the messages.
  const liveTool =
    live && live.block.type === "tool_use" && !toolMap.has(live.block.id)
      ? liveToolPart(live)
      : null;

  return (
    <>
      {liveText && (
        <Message data-role="assistant" className="justify-start">
          <div className="flex flex-col overflow-auto w-full">
            <Markdown className="bg-transparent text-foreground prose prose-sm prose-invert max-w-none rounded-lg">
              {liveText}
            </Markdown>
          </div>
        </Message>
      )}
      {liveTool && (
        <Message
          data-role="assistant"
          data-kind="tool"
          className={cn("justify-start", TOOL_ROW)}
        >
          <div className="flex flex-col overflow-auto w-full">
            <div className={TOOL_GROUP}>
              <Tool toolPart={liveTool} />
            </div>
          </div>
        </Message>
      )}
      {isStreaming && <MessageShimmer />}
    </>
  );
});
LiveTail.displayName = "LiveTail";

type MessageListProps = {
  conversationId: string | null;
  onSignIn: () => void;
  onRetry: () => void;
  // Prompts the queued deck is showing instead (see useQueueDeck).
  hiddenIds: ReadonlySet<string>;
  // Prompts the deck handed over this session, which play its entrance.
  revealedIds: ReadonlySet<string>;
};

// Reads only what changes when the transcript does. Nothing here subscribes
// to the live partial, so a streamed token does not render this list.
const MessageList = memo(({ conversationId, onSignIn, onRetry, hiddenIds, revealedIds }: MessageListProps) => {
  const { data: conversation } = useConversationMessages(conversationId);
  const { data: toolMap } = useToolMap(conversationId);
  const { data: queuedMessageIds } = useQueuedMessageIds(conversationId);
  const { data: failedMessageIds } = useFailedMessageIds(conversationId);
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);
  const { data: userComponents } = useUserComponents(workspaceId);
  const messages = conversation?.messages ?? [];
  const isStreaming = conversation?.streamStatus === "streaming";

  // View is only offered for components that are still on the canvas: one the
  // agent later deleted or renamed would leave a button that does nothing.
  // The handler is the store's own action, so it is the same function every
  // render and leaves the row and Tool memos intact.
  const viewHandlerFor = (toolPart: ToolPart | undefined) => {
    const name = toolPart && viewableComponent(toolPart);
    const onCanvas = name && userComponents?.some((c) => c.name === name);
    return onCanvas ? setFocusComponentName : undefined;
  };

  // While the turn runs, its tool rows shimmer (see .tool-shimmer). A call
  // that never got a result, from a turn that died, stays "running" and
  // must not animate for the rest of the session.
  return (
    <div className="flex flex-col gap-2" data-streaming={isStreaming || undefined}>
      {messages.map((msg) => {
        const sdkMessage = msg.sdkMessage;
        if (sdkMessage.type !== "user" && sdkMessage.type !== "assistant") {
          return null;
        }

        if (hiddenIds.has(msg.id)) {
          return null;
        }

        const isFailed =
          sdkMessage.type === "user" &&
          !(queuedMessageIds?.includes(msg.id) ?? false) &&
          (failedMessageIds?.includes(msg.id) ?? false);

        const tools = rowTools(msg, toolMap);
        return (
          <MessageRow
            key={msg.id}
            msg={msg}
            tools={tools}
            views={tools.length ? tools.map(viewHandlerFor) : NO_VIEWS}
            isFailed={isFailed}
            revealed={revealedIds.has(msg.id)}
            onSignIn={onSignIn}
            onRetry={onRetry}
          />
        );
      })}
      <LiveTail
        conversationId={conversationId}
        toolMap={toolMap}
        isStreaming={isStreaming}
      />
    </div>
  );
});
MessageList.displayName = "MessageList";

const fileToBase64 = (
  file: File
): Promise<{ data: string; mediaType: SupportedImageMediaType }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // A data URL is "<metadata>,<base64>". Anything without the comma is
      // not one, and resolving with an undefined payload would put a broken
      // image on the wire rather than failing where the mistake happened.
      const base64 = result.split(",")[1];
      if (base64 === undefined) {
        reject(new Error(`Could not read ${file.name} as a data URL`));
        return;
      }
      resolve({ data: base64, mediaType: file.type as SupportedImageMediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Module level so its identity is stable: MessageList is memoized, and a
// callback recreated on every AppChat render would defeat that.
const handleSignIn = () => {
  triggerClaudeLogin();
};

type ComposerProps = {
  composer: ReturnType<typeof useComposerModel>;
  isStreaming: boolean;
  streamFailed: boolean;
  isSendPending: boolean;
  // A workspace is open to send into.
  canSend: boolean;
  onSend: (
    prompt: string,
    images: ImageAttachment[] | undefined
  ) => Promise<void>;
  onStop: () => void;
  isStopPending: boolean;
  onReconnect: () => void;
};

// Owns the draft (text and attached images) so a keystroke re-renders only
// this, not the transcript above it. Nothing outside needs the draft: a send
// hands the finished prompt up through onSend.
function Composer({
  composer,
  isStreaming,
  streamFailed,
  isSendPending,
  canSend,
  onSend,
  onStop,
  isStopPending,
  onReconnect,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const isLoading = isSendPending || isStreaming;

  const handleFilesAdded = (files: File[]) => {
    const imageFiles = files.filter((f) =>
      SUPPORTED_IMAGE_TYPES.includes(f.type as SupportedImageMediaType)
    );
    if (imageFiles.length > 0) {
      setAttachedImages((prev) => [...prev, ...imageFiles]);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) =>
      SUPPORTED_IMAGE_TYPES.includes(f.type as SupportedImageMediaType)
    );
    if (files.length > 0) {
      e.preventDefault();
      handleFilesAdded(files);
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Create object URLs once per file array to prevent memory leaks
  const imageUrls = useMemo(
    () => attachedImages.map((file) => URL.createObjectURL(file)),
    [attachedImages]
  );

  // Cleanup object URLs when they change or component unmounts
  useEffect(() => {
    return () => imageUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [imageUrls]);

  // Asking the frames about tags takes a moment, before the composer clears:
  // a second Enter then must not send the message again.
  const submitting = useRef(false);

  const handleSubmit = async () => {
    if (!canSend || !input.trim() || isSendPending || submitting.current) return;
    submitting.current = true;
    try {
      // Elements tagged on the canvas lead the message.
      const tagged = await describePendingTags();
      const prompt = tagged.block ? `${tagged.block}\n\n${input.trim()}` : input.trim();

      let imagesToSend: ImageAttachment[] | undefined;
      try {
        imagesToSend =
          attachedImages.length > 0
            ? await Promise.all(attachedImages.map(fileToBase64))
            : undefined;
      } catch (err) {
        console.error("Failed to process images:", err);
        // TODO: show toast if toast system exists
        alert("Failed to process attached images. Please try again.");
        return;
      }

      setInput("");
      setAttachedImages([]);
      untagTags(tagged.tags);

      try {
        await onSend(prompt, imagesToSend);
      } catch (err) {
        retagTags(tagged.tags);
        throw err;
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <FileUpload onFilesAdded={handleFilesAdded} accept="image/*">
      <div className="p-4 pt-2">
        {streamFailed && <StreamError onReconnect={onReconnect} />}
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={isLoading}
          onSubmit={handleSubmit}
          className="bg-neutral-700 border-neutral-600"
        >
          <TagChips />
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 pb-0">
              {attachedImages.map((file, index) => (
                <div key={index} className="relative group">
                  <img
                    src={imageUrls[index]}
                    alt={file.name}
                    className="h-16 w-16 rounded-lg object-cover border border-neutral-600"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-1.5 -right-1.5 bg-neutral-600 hover:bg-neutral-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <PromptInputTextarea
            placeholder="Ask me anything..."
            className="bg-transparent dark:bg-transparent"
            onPaste={handlePaste}
          />
          <PromptInputActions className="justify-between pt-2">
            <div className="flex items-center gap-2">
              <ModelPicker
                models={composer.models}
                value={composer.selectedModelId}
                onChange={composer.handleModelChange}
              />
              <EffortDropdown
                levels={composer.effortLevels}
                value={composer.effort}
                onChange={composer.handleEffortChange}
              />
            </div>
            <div className="flex items-center gap-2">
              <PromptInputAction tooltip="Attach image">
                <FileUploadTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </FileUploadTrigger>
              </PromptInputAction>
              {isStreaming && (
                <PromptInputAction tooltip="Stop generation">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={onStop}
                    disabled={isStopPending}
                  >
                    <Square className="size-4 fill-current" />
                  </Button>
                </PromptInputAction>
              )}
              <PromptInputAction
                tooltip={isStreaming ? "Queue message" : "Send message"}
              >
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={handleSubmit}
                  disabled={!input.trim() || isSendPending}
                >
                  <ArrowUp className="size-4" />
                </Button>
              </PromptInputAction>
            </div>
          </PromptInputActions>
        </PromptInput>
      </div>

      <FileUploadContent className="border-2 border-dashed border-neutral-500">
        <div className="flex flex-col items-center gap-2 text-neutral-300">
          <ImageIcon className="size-12" />
          <p className="text-lg font-medium">Drop images here</p>
        </div>
      </FileUploadContent>
    </FileUpload>
  );
}

type AppChatProps = React.ComponentProps<"div">;

export function AppChat({ className, ...props }: AppChatProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const setActiveConversationId = useWorkspaceStore((s) => s.setActiveConversationId);

  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const generateTitle = useGenerateTitle();
  const cancelStream = useCancelStream();
  const queryClient = useQueryClient();
  const { data: conversation, isLoading: isConversationLoading } =
    useConversationMessages(activeConversationId);

  const isStreaming = conversation?.streamStatus === "streaming";
  // The retry budget ran out. Nothing reopens on its own from here, so this
  // stays until the user acts on it or sends again.
  const streamFailed = conversation?.streamStatus === "error";

  // Only an in-flight HTTP send blocks submitting. Streaming does not: a
  // mid-turn send is queued by the CLI and acked via message_accepted.
  const isSendPending = createConversation.isPending || sendMessage.isPending;
  const isLoading = isSendPending || isStreaming;

  const composer = useComposerModel(activeConversationId, conversation);
  const deck = useQueueDeck(activeConversationId);

  // Show the chat empty state whenever the active conversation has no messages
  // yet — not just when no conversation exists. Guard against the message fetch
  // flash so it doesn't flicker while an existing conversation loads.
  const hasMessages = (conversation?.messages?.length ?? 0) > 0;
  const showEmptyState = !hasMessages && !isLoading && !isConversationLoading;

  const handleSend = async (
    prompt: string,
    imagesToSend: ImageAttachment[] | undefined
  ) => {
    if (!activeWorkspaceId) return;

    // Sending while disconnected would otherwise post into a conversation
    // nothing is watching: the owner effect is keyed on the conversation, and
    // that has not changed, so only this reopens the stream.
    if (streamFailed && activeConversationId) {
      retryStream(activeConversationId, queryClient);
    }

    // Generate userMessageId for dedup
    const userMessageId = crypto.randomUUID();

    let conversationId = activeConversationId;

    if (!conversationId) {
      const conv = await createConversation.mutateAsync({
        workspaceId: activeWorkspaceId,
      });
      setActiveConversationId(conv.id);
      conversationId = conv.id;
    }

    // The composer selection rides the message — the send is the only
    // moment options are set (persisted on the row and applied to the CLI).
    await sendMessage.mutateAsync({
      message: prompt,
      workspaceId: activeWorkspaceId,
      conversationId,
      userMessageId,
      images: imagesToSend,
      model: composer.selectedModelId,
      effort: composer.effort,
      // This render's status, not the cache's: retryStream above has already
      // written "streaming" into the cache when the stream had failed.
      sentMidTurn: isStreaming,
    });

    // Fire-and-forget title generation if conversation has no title/summary yet
    const needsTitle = !conversation?.title && !conversation?.summary;
    if (needsTitle) {
      generateTitle.mutate({
        conversationId,
        workspaceId: activeWorkspaceId,
        firstMessage: splitTagged(prompt).text,
      });
    }
  };

  const handleStop = () => {
    if (activeConversationId) {
      cancelStream.mutate(activeConversationId);
    }
  };

  const handleReconnect = () => {
    if (!activeConversationId) return;
    retryStream(activeConversationId, queryClient);
  };

  const handleRetry = async () => {
    if (!activeWorkspaceId || !activeConversationId || isSendPending) return;

    await sendMessage.mutateAsync({
      message: "Logged in, continue.",
      workspaceId: activeWorkspaceId,
      conversationId: activeConversationId,
      userMessageId: crypto.randomUUID(),
      // Every send is a full options overwrite — omitting these would null
      // the row's snapshot and run the retry on CLI defaults.
      model: composer.selectedModelId,
      effort: composer.effort,
    });
  };

  // The transcript's rows are memoized on their props, and this one is handed
  // to every row. Read through a ref so its identity never changes: what it
  // closes over (pending sends, the composer's model) moves on every send.
  const handleRetryRef = useRef(handleRetry);
  useLayoutEffect(() => {
    handleRetryRef.current = handleRetry;
  });
  const onRetry = useCallback(() => {
    void handleRetryRef.current();
  }, []);

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden bg-[#2A2A2A] h-full",
        className
      )}
      {...props}
    >
      <ChatContainerRoot className="flex-1">
        <ChatContainerContent className={cn("p-4", showEmptyState && "min-h-full")}>
          {showEmptyState && (
            <div className="flex-1 flex items-end justify-start pl-3">
              <ChatEmptyState />
            </div>
          )}
          <MessageList
            conversationId={activeConversationId}
            onSignIn={handleSignIn}
            onRetry={onRetry}
            hiddenIds={deck.hiddenIds}
            revealedIds={deck.revealedIds}
          />
          {activeConversationId && (
            <QueuedMessagesDeck
              conversationId={activeConversationId}
              rows={deck.rows}
            />
          )}
        </ChatContainerContent>
      </ChatContainerRoot>

      <Composer
        composer={composer}
        isStreaming={isStreaming}
        streamFailed={streamFailed}
        isSendPending={isSendPending}
        canSend={!!activeWorkspaceId}
        onSend={handleSend}
        onStop={handleStop}
        isStopPending={cancelStream.isPending}
        onReconnect={handleReconnect}
      />
    </div>
  );
}

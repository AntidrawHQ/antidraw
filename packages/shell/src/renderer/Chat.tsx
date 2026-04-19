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
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/renderer/components/ui/prompt-input";
import { Button } from "@/renderer/components/ui/button";
import { cn } from "@/renderer/lib/utils";
import { ArrowUp, ImageIcon, Paperclip, Square, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  useCancelStream,
  useConversationMessages,
  useConversationWithStream,
  useCreateConversation,
  useGenerateTitle,
  useSendMessage,
  useToolMap,
} from "./lib/claude-code-ops";
import { Tool } from "@/renderer/components/ui/tool";
import { useWorkspaceStore } from "./store/workspace";
import {
  SUPPORTED_IMAGE_TYPES,
  type ImageAttachment,
  type SupportedImageMediaType,
} from "@/shared/utils/message";

type MessageListProps = {
  conversationId: string | null;
};

const MessageList = memo(({ conversationId }: MessageListProps) => {
  const { data: conversation } = useConversationMessages(conversationId);
  const { data: toolMap } = useToolMap(conversationId);
  const messages = conversation?.messages ?? [];

  return (
    <>
      {messages.map((msg) => {
        const sdkMessage = msg.sdkMessage;
        if (sdkMessage.type !== "user" && sdkMessage.type !== "assistant") {
          return null;
        }

        const isAssistant = sdkMessage.type === "assistant";
        const content = sdkMessage.message.content;
        const blocks = Array.isArray(content)
          ? content
          : typeof content === "string"
            ? [{ type: "text" as const, text: content }]
            : [];

        type Base64ImageBlock = {
          type: "image";
          source: {
            type: "base64";
            media_type: SupportedImageMediaType;
            data: string;
          };
        };
        const imageBlocks = blocks.filter(
          (b): b is Base64ImageBlock =>
            b.type === "image" &&
            "source" in b &&
            b.source?.type === "base64"
        );

        return (
          <Message
            key={msg.id}
            className={isAssistant ? "justify-start" : "justify-end"}
          >
            <div className="overflow-auto space-y-2 w-full">
              {imageBlocks.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {imageBlocks.map((block, idx) => (
                    <img
                      key={`img-${idx}`}
                      src={`data:${block.source.media_type};base64,${block.source.data}`}
                      alt="Attached image"
                      className="h-10 w-10 rounded object-cover border border-neutral-600"
                    />
                  ))}
                </div>
              )}
              {blocks.map((block, idx) => {
                if (block.type === "image") {
                  return null;
                }

                if (block.type === "text") {
                  return isAssistant ? (
                    <div
                      key={idx}
                      className="bg-secondary text-foreground prose prose-sm prose-invert rounded-lg p-2"
                    >
                      <Markdown>{block.text}</Markdown>
                    </div>
                  ) : (
                    <MessageContent
                      key={idx}
                      className="bg-neutral-700 text-neutral-200 prose prose-sm prose-invert"
                    >
                      {block.text}
                    </MessageContent>
                  );
                }

                if (block.type === "tool_use") {
                  const toolPart = toolMap?.get(block.id);
                  if (toolPart) {
                    return (
                      <Tool
                        key={idx}
                        toolPart={toolPart}
                        className="w-full"
                      />
                    );
                  }
                  return null;
                }

                // Skip tool_result - handled by Tool component above
                if (block.type === "tool_result") {
                  return null;
                }

                return null;
              })}
            </div>
          </Message>
        );
      })}
    </>
  );
});
MessageList.displayName = "MessageList";

type AppChatProps = React.ComponentProps<"div">;

export function AppChat({ className, ...props }: AppChatProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const setActiveConversationId = useWorkspaceStore((s) => s.setActiveConversationId);
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState<File[]>([]);

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

  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const generateTitle = useGenerateTitle();
  const cancelStream = useCancelStream();
  const { data: conversation } = useConversationWithStream(activeConversationId);

  const isStreaming = conversation?.streamStatus === "streaming";

  const isLoading = createConversation.isPending || sendMessage.isPending || isStreaming;

  const fileToBase64 = (
    file: File
  ): Promise<{ data: string; mediaType: SupportedImageMediaType }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve({ data: base64, mediaType: file.type as SupportedImageMediaType });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async () => {
    if (!activeWorkspaceId || !input.trim() || isLoading) return;

    const prompt = input.trim();

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

    // Generate userMessageId for dedup
    const userMessageId = crypto.randomUUID();

    let conversationId = activeConversationId;

    if (!conversationId) {
      const conv = await createConversation.mutateAsync(activeWorkspaceId);
      setActiveConversationId(conv.id);
      conversationId = conv.id;
    }

    await sendMessage.mutateAsync({
      message: prompt,
      workspaceId: activeWorkspaceId,
      conversationId,
      userMessageId,
      images: imagesToSend,
    });

    // Fire-and-forget title generation if conversation has no title/summary yet
    const needsTitle = !conversation?.title && !conversation?.summary;
    if (needsTitle) {
      generateTitle.mutate({
        conversationId,
        workspaceId: activeWorkspaceId,
        firstMessage: prompt,
      });
    }
  };

  const handleStop = () => {
    if (activeConversationId) {
      cancelStream.mutate(activeConversationId);
    }
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden bg-neutral-800 h-full",
        className
      )}
      {...props}
    >
      <ChatContainerRoot className="flex-1">
        <ChatContainerContent className="p-4">
          <MessageList conversationId={activeConversationId} />
        </ChatContainerContent>
      </ChatContainerRoot>

      <FileUpload onFilesAdded={handleFilesAdded} accept="image/*">
        <div className="p-4">
          <PromptInput
            value={input}
            onValueChange={setInput}
            isLoading={isLoading}
            onSubmit={handleSubmit}
            className="bg-neutral-700 border-neutral-600"
          >
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
            <PromptInputActions className="justify-end pt-2">
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
              {isStreaming ? (
                <PromptInputAction tooltip="Stop generation">
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={handleStop}
                    disabled={cancelStream.isPending}
                  >
                    <Square className="size-4 fill-current" />
                  </Button>
                </PromptInputAction>
              ) : (
                <PromptInputAction tooltip="Send message">
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={handleSubmit}
                    disabled={!input.trim() || isLoading}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                </PromptInputAction>
              )}
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
    </div>
  );
}

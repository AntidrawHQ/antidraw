import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/renderer/components/ui/chat-container";
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
import { ArrowUp, Square } from "lucide-react";
import { useState } from "react";
import {
  useCancelStream,
  useConversationWithStream,
  useCreateConversation,
  useGenerateTitle,
  useSendMessage,
  useToolMap,
} from "./lib/claude-code-ops";
import { Tool } from "@/renderer/components/ui/tool";
import { useWorkspaceStore } from "./store/workspace";

type AppChatProps = React.ComponentProps<"div">;

export function AppChat({ className, ...props }: AppChatProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const setActiveConversationId = useWorkspaceStore((s) => s.setActiveConversationId);
  const [input, setInput] = useState("");

  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const generateTitle = useGenerateTitle();
  const cancelStream = useCancelStream();
  const { data: conversation } = useConversationWithStream(activeConversationId);
  const { data: toolMap } = useToolMap(activeConversationId);

  const messages = conversation?.messages ?? [];
  const isStreaming = conversation?.streamStatus === "streaming";

  const isLoading = createConversation.isPending || sendMessage.isPending || isStreaming;

  const handleSubmit = async () => {
    if (!activeWorkspaceId || !input.trim() || isLoading) return;

    const prompt = input.trim();
    setInput("");

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

            return (
              <Message
                key={msg.id}
                className={isAssistant ? "justify-start" : "justify-end"}
              >
                <div className="overflow-auto space-y-2 w-full">
                  {blocks.map((block, idx) => {
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
        </ChatContainerContent>
      </ChatContainerRoot>

      <div className="p-4">
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={isLoading}
          onSubmit={handleSubmit}
          className="bg-neutral-700 border-neutral-600"
        >
          <PromptInputTextarea
            placeholder="Ask me anything..."
            className="bg-transparent dark:bg-transparent"
          />
          <PromptInputActions className="justify-end pt-2">
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
    </div>
  );
}

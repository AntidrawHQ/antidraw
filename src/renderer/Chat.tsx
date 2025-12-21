import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/renderer/components/ui/chat-container";
import { Markdown } from "@/renderer/components/ui/markdown";
import {
  Message,
  MessageContent,
} from "@/renderer/components/ui/message";
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

type AppChatProps = React.ComponentProps<"div">;

export function AppChat({ className, ...props }: AppChatProps) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "user",
      content: "Hello! Can you help me with a coding question?",
    },
    {
      id: 2,
      role: "assistant",
      content:
        "Of course! I'd be happy to help with your coding question. What would you like to know?",
    },
    {
      id: 3,
      role: "user",
      content: "How do I create a responsive layout with CSS Grid?",
    },
    {
      id: 4,
      role: "assistant",
      content:
        "Creating a responsive layout with CSS Grid is straightforward. Here's a basic example:\n\n```css\n.container {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));\n  gap: 1rem;\n}\n```\n\nThis creates a grid where:\n- Columns automatically fit as many as possible\n- Each column is at least 250px wide\n- Columns expand to fill available space\n- There's a 1rem gap between items\n\nWould you like me to explain more about how this works?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      id: messages.length + 1,
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Simulate assistant response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          role: "assistant",
          content:
            "That's a great question! Let me explain further. CSS Grid is a powerful layout system that allows for two-dimensional layouts. The `minmax()` function is particularly useful as it sets a minimum and maximum size for grid tracks.",
        },
      ]);
      setIsLoading(false);
    }, 2000);
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
          {messages.map((message) => {
            const isAssistant = message.role === "assistant";

            return (
              <Message
                key={message.id}
                className={
                  message.role === "user" ? "justify-end" : "justify-start"
                }
              >
                <div className="overflow-auto">
                  {isAssistant ? (
                    <div className="bg-secondary text-foreground prose prose-sm prose-invert rounded-lg p-2">
                      <Markdown>{message.content}</Markdown>
                    </div>
                  ) : (
                    <MessageContent className="bg-neutral-700 text-neutral-200 prose prose-sm prose-invert">
                      {message.content}
                    </MessageContent>
                  )}
                </div>
              </Message>
            );
          })}
        </ChatContainerContent>
      </ChatContainerRoot>

      <div className="border-t border-neutral-700 p-4">
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
            <PromptInputAction
              tooltip={isLoading ? "Stop generation" : "Send message"}
            >
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={handleSubmit}
                disabled={!input.trim() && !isLoading}
              >
                {isLoading ? (
                  <Square className="size-4 fill-current" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}

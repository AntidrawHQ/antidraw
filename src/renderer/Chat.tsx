import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/renderer/components/ui/chat-container";
import { Markdown } from "@/renderer/components/ui/markdown";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/renderer/components/ui/message";
import { Button } from "@/renderer/components/ui/button";
import { cn } from "@/renderer/lib/utils";
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

  const addMessage = () => {
    // Add a new message
    setMessages([
      ...messages,
      {
        id: messages.length + 1,
        role:
          messages[messages.length - 1].role === "user" ? "assistant" : "user",
        content:
          messages[messages.length - 1].role === "user"
            ? "That's a great question! Let me explain further. CSS Grid is a powerful layout system that allows for two-dimensional layouts. The `minmax()` function is particularly useful as it sets a minimum and maximum size for grid tracks."
            : "Thanks for the explanation! Could you tell me more about grid areas?",
      },
    ]);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden bg-neutral-800 h-screen",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b ">
        {/* <div />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={addMessage}>
            Add Message
          </Button>
        </div> */}
      </div>

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
    </div>
  );
}

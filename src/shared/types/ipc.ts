import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// Event types for agent message streaming

export type AgentErrorEvent = {
  conversationId: string;
};

export type AgentMessageEvent = {
  conversationId: string;
  message: SDKMessage;
};

export type AgentDoneEvent = {
  conversationId: string;
};

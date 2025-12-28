import type { UUID } from "crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export const createUserSDKMessage = (params: {
  text: string;
  sessionId: string;
  uuid: UUID;
}): SDKUserMessage => ({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "text", text: params.text }],
  },
  session_id: params.sessionId,
  uuid: params.uuid,
  parent_tool_use_id: null,
});

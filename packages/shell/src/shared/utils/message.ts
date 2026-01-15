import type { UUID } from "crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ImageBlockParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

export type ImageAttachment = {
  data: string;
  mediaType: string;
};

export const createUserSDKMessage = (params: {
  text: string;
  sessionId: string;
  uuid: UUID;
  images?: ImageAttachment[];
}): SDKUserMessage => {
  const content: (ImageBlockParam | TextBlockParam)[] = [
    ...(params.images?.map(
      (img): ImageBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType as
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp",
          data: img.data,
        },
      })
    ) ?? []),
    { type: "text", text: params.text },
  ];

  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
    session_id: params.sessionId,
    uuid: params.uuid,
    parent_tool_use_id: null,
  };
};

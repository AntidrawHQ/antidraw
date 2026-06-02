import type { UUID } from "crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ImageBlockParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

export type SupportedImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export const SUPPORTED_IMAGE_TYPES: SupportedImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export type ImageAttachment = {
  data: string;
  mediaType: SupportedImageMediaType;
};

export const createUserSDKMessage = (params: {
  text: string;
  uuid: UUID;
  images?: ImageAttachment[];
}): SDKUserMessage => {
  const content: (ImageBlockParam | TextBlockParam)[] = [
    ...(params.images?.map(
      (img): ImageBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
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
    uuid: params.uuid,
    parent_tool_use_id: null,
  };
};

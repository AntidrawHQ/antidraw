import type {
  ChatMessageResponse,
  Conversation,
  ConversationWithMessages,
} from "@/main/api";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { ok, err } from "neverthrow";

export async function* sendMessage(params: {
  message: string;
  conversationId?: string;
}): AsyncGenerator<ChatMessageResponse> {
  const { message, conversationId } = params;

  const stream = new ReadableStream<ChatMessageResponse>({
    start(controller) {
      fetchEventSource("antidraw://_internal/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          conversationId,
        }),

        onmessage: (ev) => {
          controller.enqueue(JSON.parse(ev.data) as ChatMessageResponse);
        },
        onerror: (err) => controller.error(err),
        onclose: () => controller.close(),
      });
    },
  });

  yield* stream;
}

export const getConversationWithMessages = async (conversationId: string) => {
  try {
    const response = await fetch(
      `antidraw://_internal/chat/${conversationId}`
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: ConversationWithMessages = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to fetch conversation",
    });
  }
};

export const createConversation = async () => {
  try {
    const response = await fetch("antidraw://_internal/chat/conversation", {
      method: "POST",
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: Conversation = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to create conversation",
    });
  }
};

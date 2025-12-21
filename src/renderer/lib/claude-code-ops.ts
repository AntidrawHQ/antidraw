import { ChatMessageResponse } from "@/main/api";
import { fetchEventSource } from "@microsoft/fetch-event-source";

export async function* sendMessage(params: {
  message: string;
  conversationID?: string;
}): AsyncGenerator<ChatMessageResponse> {
  const { message, conversationID } = params;

  const stream = new ReadableStream<ChatMessageResponse>({
    start(controller) {
      fetchEventSource("designsette://_internal/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          conversationID,
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

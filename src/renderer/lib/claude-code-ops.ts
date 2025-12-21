import { fetchEventSource } from "@microsoft/fetch-event-source";

export async function* sendMessage(params: {
  message: string;
  conversationID?: string;
}): AsyncGenerator<string> {
  const { message, conversationID } = params;

  const stream = new ReadableStream<string>({
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

        onmessage: (ev) => controller.enqueue(ev.data),
        onerror: (err) => controller.error(err),
        onclose: () => controller.close(),
      });
    },
  });

  yield* stream;
}

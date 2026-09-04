import { EventEmitter } from "events";
import type { Message } from "@/main/api/models/chat.model";
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CliSessionState } from "./types";
import type { LivePartial } from "@/shared/utils/live-partial";

// The event vocabulary, declared once. Everything else here is derived from
// it: the emitter's signatures, the wire union the renderer consumes, and the
// fan-out in subscribe(). Adding an event is one entry plus one name below.
export type ConversationEventPayloads = {
  message: { message: Message };
  partial: { partial: SDKPartialAssistantMessage };
  livePartial: { livePartial: LivePartial | null };
  state: { state: CliSessionState };
  queue: { userMessageIds: string[] };
  error: { error: string };
  effort: { level: string };
};

// The runtime half of the vocabulary. `satisfies` rejects a name with no
// payload; the assertion under it rejects a payload with no name — which is
// the direction that actually bites, since a missing name is a listener that
// is never registered and so an event that silently never arrives.
export const CONVERSATION_EVENT_NAMES = [
  "message",
  "partial",
  "livePartial",
  "state",
  "queue",
  "error",
  "effort",
] as const satisfies readonly (keyof ConversationEventPayloads)[];

export type ConversationEventName = (typeof CONVERSATION_EVENT_NAMES)[number];

const _everyPayloadIsNamed: ConversationEventName =
  null as unknown as keyof ConversationEventPayloads;
void _everyPayloadIsNamed;

type ConversationEvents = {
  [K in ConversationEventName]: [
    conversationId: string,
    payload: ConversationEventPayloads[K],
  ];
};

class ConversationEventEmitter extends EventEmitter<ConversationEvents> {}

export const conversationEvents = new ConversationEventEmitter();

// Node gives "error" special treatment: emitting it with no listener attached
// throws ERR_UNHANDLED_ERROR instead of returning false like every other
// event. Subscribers only exist while something is watching, so a turn that
// fails before the renderer connects — a failed spawn, most likely — would
// replace its own cause with a meaningless unhandled-error. This permanent
// listener keeps emit() ordinary and makes sure the reason is logged whether
// anyone is watching or not.
conversationEvents.on("error", (conversationId, { error }) => {
  console.error(`Conversation ${conversationId} failed:`, error);
});

// What a subscriber receives: the same payloads, tagged, ready to go on the
// wire as-is.
export type StreamEvent = {
  [K in ConversationEventName]: { type: K } & ConversationEventPayloads[K];
}[ConversationEventName];

// EventEmitter's on/off resolve their listener type from a concrete key. With
// the key still generic TS cannot prove the match, though every instantiation
// does hold. Narrowed once, here, so no caller needs to.
const untyped = conversationEvents as unknown as {
  on(name: string, listener: (...args: never[]) => void): void;
  off(name: string, listener: (...args: never[]) => void): void;
};

const relay = <K extends ConversationEventName>(
  name: K,
  conversationId: string,
  onEvent: (event: StreamEvent) => void,
) => {
  const handler = (convId: string, payload: ConversationEventPayloads[K]) => {
    if (convId !== conversationId) return;
    onEvent({ type: name, ...payload } as StreamEvent);
  };
  untyped.on(name, handler as (...args: never[]) => void);
  return () => {
    untyped.off(name, handler as (...args: never[]) => void);
  };
};

// Every event for one conversation, as a single tagged stream. Returns the
// unsubscribe. Callers never name the individual events, so a new one reaches
// them without any change on their side.
export const subscribe = (
  conversationId: string,
  onEvent: (event: StreamEvent) => void,
): (() => void) => {
  const offs = CONVERSATION_EVENT_NAMES.map((name) =>
    relay(name, conversationId, onEvent),
  );
  return () => {
    for (const off of offs) off();
  };
};

import { describe, test, expect } from "vitest";
import type { UUID } from "node:crypto";
import type { Message } from "@/main/api";
import { createUserSDKMessage } from "@/shared/utils/message";
import { isInDeck, departures, type DeckSources } from "../use-queue-deck";

let seq = 0;
const prompt = (text: string, extra: Partial<Message> = {}): Message => {
  const id = crypto.randomUUID();
  return {
    id,
    conversationId: "c",
    messageType: "user_prompt",
    sdkMessage: createUserSDKMessage({ text, uuid: id as UUID }),
    seq: ++seq,
    createdAt: new Date(0),
    deliveredAt: null,
    acceptedAfterSeq: null,
    ...extra,
  };
};

const textOf = (m: Message) => {
  const content = (m.sdkMessage as { message: { content: unknown } }).message.content;
  return ((Array.isArray(content) ? content[0] : content) as { text: string }).text;
};

describe("isInDeck", () => {
  test("holds a prompt from a mid-turn send until the CLI accepts it", () => {
    const reply = { ...prompt("assistant reply"), messageType: "sdk_message" };
    const beforeQueueEvent = prompt("sent mid-turn, before the queue event names it");
    const listed = prompt("sent mid-turn, listed in the queue");
    const idleSend = prompt("sent to an idle agent, listed for its ack's few ms");
    const openedWaiting = prompt("already waiting when the conversation opened");
    const accepted = prompt("sent mid-turn, accepted", { acceptedAfterSeq: 1 });
    const failed = prompt("sent mid-turn, never reached the CLI");
    const old = prompt("an old prompt");

    const sources: DeckSources = {
      queued: new Set([listed.id, idleSend.id, openedWaiting.id]),
      failed: new Set([failed.id]),
      intents: {
        [beforeQueueEvent.id]: "queue",
        [listed.id]: "queue",
        [idleSend.id]: "direct",
        [accepted.id]: "queue",
        [failed.id]: "queue",
      },
    };

    const where = [reply, beforeQueueEvent, listed, idleSend, openedWaiting, accepted, failed, old]
      .map((m) => `${isInDeck(m, sources) ? "deck      " : "transcript"}  ${textOf(m)}`);
    expect(where).toMatchInlineSnapshot(`
      [
        "transcript  assistant reply",
        "deck        sent mid-turn, before the queue event names it",
        "deck        sent mid-turn, listed in the queue",
        "transcript  sent to an idle agent, listed for its ack's few ms",
        "deck        already waiting when the conversation opened",
        "transcript  sent mid-turn, accepted",
        "transcript  sent mid-turn, never reached the CLI",
        "transcript  an old prompt",
      ]
    `);
  });
});

describe("departures", () => {
  test("a row still in the cache was accepted; one gone from it was cancelled", () => {
    const a = prompt("accepted");
    const b = prompt("cancelled");
    const c = prompt("still waiting");
    const placedA = { ...a, acceptedAfterSeq: 9 };

    const left = departures([a, b, c], [c], [placedA, c]);

    expect(
      left.map((r) => ({
        text: textOf(r.message),
        leaving: r.leaving,
        // An accepted row carries its placement out; a cancelled one keeps
        // the copy the deck last rendered.
        acceptedAfterSeq: r.message.acceptedAfterSeq,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "acceptedAfterSeq": 9,
          "leaving": "accepted",
          "text": "accepted",
        },
        {
          "acceptedAfterSeq": null,
          "leaving": "cancelled",
          "text": "cancelled",
        },
      ]
    `);
  });

  test("nothing left, nothing departs", () => {
    const a = prompt("a");
    expect(departures([a], [a], [a])).toMatchInlineSnapshot(`[]`);
  });
});

import { describe, test, expect, afterEach } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { handleSdkMessageWithoutPersisting } from "@/main/api/turn";
import { buildPrompt } from "@/main/api/claude-code-ops";
import {
  addPending,
  openHandle,
  subscribe,
  getPending,
  getHandle,
  releaseHandle,
} from "@/main/lib/conversation-store";

// Wire shapes the CLI actually emits, narrowed to the fields the handler
// reads. Real function, real store, real emitter — only the input is authored.
const partial = (): SDKMessage =>
  ({ type: "stream_event", event: { type: "content_block_delta" } }) as never;

const sessionState = (state: string): SDKMessage =>
  ({ type: "system", subtype: "session_state_changed", state }) as never;

const replayAck = (uuid: string): SDKMessage =>
  ({ type: "user", isReplay: true, uuid }) as never;

const assistant = (): SDKMessage =>
  ({ type: "assistant", uuid: crypto.randomUUID(), message: {} }) as never;

const result = (): SDKMessage =>
  ({ type: "result", subtype: "success", uuid: crypto.randomUUID() }) as never;

const init = (): SDKMessage =>
  ({ type: "system", subtype: "init", session_id: "s-1" }) as never;

let counter = 0;
const liveConversation = () => {
  const id = `handled-${counter++}`;
  openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));
  return id;
};

const detach: Array<() => void> = [];
afterEach(() => detach.splice(0).forEach((off) => off()));

const capture = (conversationId: string) => {
  const seen: unknown[] = [];
  detach.push(
    subscribe(conversationId, (event) => {
      if (event.type === "state") seen.push({ state: event.state });
      if (event.type === "queue") seen.push({ queue: event.userMessageIds });
      if (event.type === "partial") seen.push({ partial: true });
    }),
  );
  return seen;
};

describe("messages handled without persisting", () => {
  test("a partial is relayed and not persisted", () => {
    const id = liveConversation();
    const seen = capture(id);
    expect(handleSdkMessageWithoutPersisting(id, partial())).toBe(true);
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "partial": true,
        },
      ]
    `);
  });

  test("a session state change is mirrored onto the runtime", () => {
    const id = liveConversation();
    const seen = capture(id);
    expect(handleSdkMessageWithoutPersisting(id, sessionState("running"))).toBe(true);
    expect(getHandle(id)?.cliState).toBe("running");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "running",
        },
      ]
    `);
  });

  test("a replay ack takes the message out of the queue", () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    addPending(id, "msg-b");
    const seen = capture(id);
    expect(handleSdkMessageWithoutPersisting(id, replayAck("msg-a"))).toBe(true);
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "queue": [
            "msg-b",
          ],
        },
      ]
    `);
  });

  test("a replay of a message we never pushed is silent", () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    const seen = capture(id);
    // CLI-internal reminders come back as replays too, carrying uuids we
    // never stamped. They must not disturb the queue.
    expect(handleSdkMessageWithoutPersisting(id, replayAck("never-sent"))).toBe(true);
    expect(seen).toMatchInlineSnapshot(`[]`);
    expect(getPending(id)).toEqual(["msg-a"]);
  });
});

describe("messages that belong in the transcript", () => {
  test.each([
    ["assistant", assistant()],
    ["result", result()],
    ["init", init()],
  ])("%s is left for the persisting path", (_label, sdkMessage) => {
    const id = liveConversation();
    const seen = capture(id);
    expect(handleSdkMessageWithoutPersisting(id, sdkMessage)).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe("idle while messages are still queued", () => {
  test("idle is reported truthfully and the queue is left intact", () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    const seen = capture(id);

    // The CLI reports idle for a push it has not parsed yet. The old code
    // held the turn open and armed a 30s watchdog; now both facts simply
    // travel separately — "idle, with one queued" is exactly what is true.
    handleSdkMessageWithoutPersisting(id, sessionState("idle"));
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "idle",
        },
      ]
    `);
    expect(getPending(id)).toEqual(["msg-a"]);

    // ...and the CLI's `running` for that push follows moments later.
    handleSdkMessageWithoutPersisting(id, sessionState("running"));
    handleSdkMessageWithoutPersisting(id, replayAck("msg-a"));
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "idle",
        },
        {
          "state": "running",
        },
        {
          "queue": [],
        },
      ]
    `);
  });

  test("a full turn's signals arrive in order", () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    const seen = capture(id);
    for (const m of [
      sessionState("running"),
      replayAck("msg-a"),
      partial(),
      sessionState("idle"),
    ]) {
      handleSdkMessageWithoutPersisting(id, m);
    }
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "running",
        },
        {
          "queue": [],
        },
        {
          "partial": true,
        },
        {
          "state": "idle",
        },
      ]
    `);
    releaseHandle(id);
  });
});

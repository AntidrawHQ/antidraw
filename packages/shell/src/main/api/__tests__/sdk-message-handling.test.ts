import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import type { UUID } from "node:crypto";
import { describe, test, expect, afterEach, beforeAll } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { db } from "@/main/db";
import { messages, workspaces, type Message } from "@/main/api/schema";
import type { ConversationWithMessages } from "@/main/api";
import { handleSdkMessageWithoutPersisting } from "@/main/api/turn";
import { buildPrompt } from "@/main/api/claude-code-ops";
import {
  addMessage,
  convertUserPromptToSDKMessage,
  createConversation,
  getConversation,
  getMessagesAfterSeq,
} from "@/main/api/services/chat.service";
import {
  addPending,
  openHandle,
  subscribe,
  getPending,
  getHandle,
  releaseHandle,
  markSpawnPrompt,
} from "@/main/lib/conversation-store";

// The replay-ack branch writes the DB (delivered_at), so this runs against
// the real one, relocated by e2e-env. Every other branch is memory-only.
const workspaceId = crypto.randomUUID();
beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
  });
  await db.insert(workspaces).values({ id: workspaceId, name: "sdk-handling" });
});

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
      else if (event.type === "queue") seen.push({ queue: event.userMessageIds });
      else if (event.type === "partial") seen.push({ partial: true });
      // Everything else is recorded too, so `[]` asserts silence — not
      // "none of the three event names this helper happened to know".
      else seen.push({ unexpected: event.type });
    }),
  );
  return seen;
};

describe("messages handled without persisting", () => {
  test("a partial is relayed and not persisted", async () => {
    const id = liveConversation();
    const seen = capture(id);
    expect(await handleSdkMessageWithoutPersisting(id, partial())).toBe(true);
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "partial": true,
        },
      ]
    `);
  });

  test("a session state change is mirrored onto the runtime", async () => {
    const id = liveConversation();
    const seen = capture(id);
    expect(await handleSdkMessageWithoutPersisting(id, sessionState("running"))).toBe(true);
    expect(getHandle(id)?.cliState).toBe("running");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "running",
        },
      ]
    `);
  });

  test("a replay ack takes the message out of the queue", async () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    addPending(id, "msg-b");
    const seen = capture(id);
    expect(await handleSdkMessageWithoutPersisting(id, replayAck("msg-a"))).toBe(true);
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

  test("a replay of a message we never pushed is silent", async () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    const seen = capture(id);
    // CLI-internal reminders come back as replays too, carrying uuids we
    // never stamped. They must not disturb the queue.
    expect(await handleSdkMessageWithoutPersisting(id, replayAck("never-sent"))).toBe(true);
    expect(seen).toMatchInlineSnapshot(`[]`);
    expect(getPending(id)).toEqual(["msg-a"]);
  });
});

describe("messages that belong in the transcript", () => {
  test.each([
    ["assistant", assistant()],
    ["result", result()],
    ["init", init()],
  ])("%s is left for the persisting path", async (_label, sdkMessage) => {
    const id = liveConversation();
    const seen = capture(id);
    expect(await handleSdkMessageWithoutPersisting(id, sdkMessage)).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe("idle while messages are still queued", () => {
  test("idle is reported truthfully and the queue is left intact", async () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    const seen = capture(id);

    // The CLI reports idle for a push it has not parsed yet. The old code
    // held the turn open and armed a 30s watchdog; now both facts simply
    // travel separately — "idle, with one queued" is exactly what is true.
    await handleSdkMessageWithoutPersisting(id, sessionState("idle"));
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "idle",
        },
      ]
    `);
    expect(getPending(id)).toEqual(["msg-a"]);

    // ...and the CLI's `running` for that push follows moments later.
    await handleSdkMessageWithoutPersisting(id, sessionState("running"));
    await handleSdkMessageWithoutPersisting(id, replayAck("msg-a"));
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

  test("a full turn's signals arrive in order", async () => {
    const id = liveConversation();
    addPending(id, "msg-a");
    const seen = capture(id);
    for (const m of [
      sessionState("running"),
      replayAck("msg-a"),
      partial(),
      sessionState("idle"),
    ]) {
      await handleSdkMessageWithoutPersisting(id, m);
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

describe("the replay ack, on the row", () => {
  const persistedConversation = async () => {
    const created = await createConversation(workspaceId);
    if (created.isErr()) throw new Error("failed to create conversation");
    const id = created.value.id;
    openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));
    return id;
  };

  const persistPrompt = async (conversationId: string) => {
    const id = crypto.randomUUID();
    const added = await addMessage({
      id,
      conversationId,
      messageType: "user_prompt",
      sdkMessage: convertUserPromptToSDKMessage("x", id as UUID),
    });
    if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
    addPending(conversationId, id);
    return id;
  };

  const deliveredAtOf = async (conversationId: string) => {
    const rows = await db
      .select({ id: messages.id, deliveredAt: messages.deliveredAt })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.seq);
    return Object.fromEntries(rows.map((r) => [r.id, r.deliveredAt !== null]));
  };

  test("stamps delivered_at on the prompt it names, and nothing else", async () => {
    const id = await persistedConversation();
    const a = await persistPrompt(id);
    const b = await persistPrompt(id);

    await handleSdkMessageWithoutPersisting(id, replayAck(a));

    expect(await deliveredAtOf(id)).toEqual({ [a]: true, [b]: false });
    expect(getPending(id)).toEqual([b]);
    releaseHandle(id);
  });

  test("the column is written before the queue event goes out", async () => {
    const id = await persistedConversation();
    const a = await persistPrompt(id);

    // The undelivered endpoint reads pending first and null rows second. If
    // the ack cleared pending before the column landed, a read in between
    // would report the prompt failed with nothing later to correct it. So
    // the pin is on order: at the moment `queue` fires, the row is stamped.
    let atQueueEvent: Promise<Record<string, boolean>> | null = null;
    detach.push(
      subscribe(id, (event) => {
        if (event.type === "queue") atQueueEvent = deliveredAtOf(id);
      }),
    );

    await handleSdkMessageWithoutPersisting(id, replayAck(a));

    expect(atQueueEvent).not.toBeNull();
    expect(await atQueueEvent!).toEqual({ [a]: true });
    releaseHandle(id);
  });

  test("a replay we never persisted writes nothing", async () => {
    const id = await persistedConversation();
    const a = await persistPrompt(id);

    await handleSdkMessageWithoutPersisting(id, replayAck("never-sent"));

    expect(await deliveredAtOf(id)).toEqual({ [a]: false });
    expect(getPending(id)).toEqual([a]);
    releaseHandle(id);
  });
});

describe("the replay ack places a prompt it was waiting on", () => {
  const persistedConversation = async () => {
    const created = await createConversation(workspaceId);
    if (created.isErr()) throw new Error("failed to create conversation");
    const id = created.value.id;
    openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));
    return id;
  };

  const persistPrompt = async (conversationId: string, text: string) => {
    const id = crypto.randomUUID();
    const added = await addMessage({
      id,
      conversationId,
      messageType: "user_prompt",
      sdkMessage: convertUserPromptToSDKMessage(text, id as UUID),
    });
    if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
    return added.value;
  };

  const persistReply = async (conversationId: string, text: string) => {
    const added = await addMessage({
      conversationId,
      messageType: "sdk_message",
      sdkMessage: {
        type: "assistant",
        uuid: crypto.randomUUID(),
        message: { content: [{ type: "text", text }] },
      } as never,
    });
    if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
    return added.value;
  };

  const textOf = (m: Message) => {
    const content = (m.sdkMessage as { message: { content: unknown } }).message.content;
    return ((Array.isArray(content) ? content[0] : content) as { text: string }).text;
  };

  // Rows as a reader would check them: in order, by text. seq numbers are
  // shared with every other test in this DB, so a placement names the row
  // it sits after instead of the number.
  const view = (rows: Message[], all: Message[] = rows) => {
    const bySeq = new Map(all.map((m) => [m.seq, textOf(m)]));
    return rows.map((m) => {
      const role = m.messageType === "user_prompt" ? "user     " : "assistant";
      const placed =
        m.acceptedAfterSeq == null
          ? ""
          : m.acceptedAfterSeq === m.seq
            ? "  ← placed after itself"
            : `  ← placed after "${bySeq.get(m.acceptedAfterSeq)}"`;
      return `${role} ${textOf(m)}${placed}`;
    });
  };

  const transcript = async (conversationId: string) => {
    const loaded = await getConversation(conversationId, { includeMessages: true });
    if (loaded.isErr()) throw new Error("getConversation failed");
    // getConversation's return type does not narrow on includeMessages.
    return (loaded.value as ConversationWithMessages).messages;
  };

  test("sorts after what the turn wrote while it waited, ahead of the reply to it", async () => {
    const id = await persistedConversation();
    const prompt = await persistPrompt(id, "queued");
    addPending(id, prompt.id);
    await persistReply(id, "turn, still going");

    await handleSdkMessageWithoutPersisting(id, replayAck(prompt.id));
    await persistReply(id, "reply to queued");

    expect(view(await transcript(id))).toMatchInlineSnapshot(`
      [
        "assistant turn, still going",
        "user      queued  ← placed after "turn, still going"",
        "assistant reply to queued",
      ]
    `);
    releaseHandle(id);
  });

  test("two accepted back to back keep the order they were sent in", async () => {
    const id = await persistedConversation();
    const a = await persistPrompt(id, "a");
    const b = await persistPrompt(id, "b");
    addPending(id, a.id);
    addPending(id, b.id);
    await persistReply(id, "turn");

    await handleSdkMessageWithoutPersisting(id, replayAck(a.id));
    await handleSdkMessageWithoutPersisting(id, replayAck(b.id));
    await persistReply(id, "reply to a and b");

    expect(view(await transcript(id))).toMatchInlineSnapshot(`
      [
        "assistant turn",
        "user      a  ← placed after "turn"",
        "user      b  ← placed after "turn"",
        "assistant reply to a and b",
      ]
    `);
    releaseHandle(id);
  });

  test("the spawn prompt is placed too", async () => {
    // A send made mid-turn that lands after the turn ended starts a fresh
    // CLI instead of queueing. The deck still waits on this ack for it.
    const id = await persistedConversation();
    const prompt = await persistPrompt(id, "spawned");
    markSpawnPrompt(id, prompt.id);

    await handleSdkMessageWithoutPersisting(id, replayAck(prompt.id));

    expect(view(await transcript(id))).toMatchInlineSnapshot(`
      [
        "user      spawned  ← placed after itself",
      ]
    `);
    releaseHandle(id);
  });

  test("a replayed history is delivered but not moved", async () => {
    const id = await persistedConversation();
    // Not awaited: this is a resumed session replaying a prompt it already ran.
    const prompt = await persistPrompt(id, "old prompt");
    await persistReply(id, "old reply");

    await handleSdkMessageWithoutPersisting(id, replayAck(prompt.id));

    expect(await deliveredAtOf(id)).toMatchInlineSnapshot(`
      [
        "old prompt: delivered",
        "old reply: -",
      ]
    `);
    expect(view(await transcript(id))).toMatchInlineSnapshot(`
      [
        "user      old prompt",
        "assistant old reply",
      ]
    `);
    releaseHandle(id);

    async function deliveredAtOf(conversationId: string) {
      const rows = await transcript(conversationId);
      return rows.map((m) => `${textOf(m)}: ${m.deliveredAt ? "delivered" : "-"}`);
    }
  });

  test("the placed row is emitted, so an open transcript moves it", async () => {
    const id = await persistedConversation();
    const prompt = await persistPrompt(id, "queued");
    addPending(id, prompt.id);
    await persistReply(id, "turn");

    const emitted: Message[] = [];
    const seen: string[] = [];
    detach.push(
      subscribe(id, (event) => {
        seen.push(event.type);
        if (event.type === "message") emitted.push(event.message);
      }),
    );
    await handleSdkMessageWithoutPersisting(id, replayAck(prompt.id));

    // The row first, the queue second: by the time the renderer hears the
    // prompt left the queue, it already knows where it goes.
    expect(seen).toMatchInlineSnapshot(`
      [
        "message",
        "queue",
      ]
    `);
    expect(view(emitted, await transcript(id))).toMatchInlineSnapshot(`
      [
        "user      queued  ← placed after "turn"",
      ]
    `);
    releaseHandle(id);
  });

  test("catch-up resends a placement made after the cursor", async () => {
    const id = await persistedConversation();
    const prompt = await persistPrompt(id, "queued");
    addPending(id, prompt.id);
    const reply = await persistReply(id, "turn");
    // Caught up to here, then disconnected — the ack lands unseen.
    const cursor = reply.seq;

    await handleSdkMessageWithoutPersisting(id, replayAck(prompt.id));
    await persistReply(id, "reply to queued");

    const after = await getMessagesAfterSeq(id, cursor);
    if (after.isErr()) throw new Error("getMessagesAfterSeq failed");
    expect(view(after.value, await transcript(id))).toMatchInlineSnapshot(`
      [
        "user      queued  ← placed after "turn"",
        "assistant reply to queued",
      ]
    `);
    releaseHandle(id);
  });
});

import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, vi } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import type { Message, StreamEvent } from "@/main/api";
import { conversationEvents } from "@/main/lib/conversation-store";

// The backlog read is the only asynchronous step between attaching the
// listener and flushing what it caught, so it is where the two interesting
// interleavings live. The gate stops the route inside that step — `before` the
// read, so a message written during the pause lands in BOTH the backlog and
// the buffer; `after` it, so the same message lands ONLY in the buffer. The
// second is the window that attaching-before-reading exists to cover: read
// first and that message reaches nobody.
const h = vi.hoisted(() => ({
  gate: null as null | {
    when: "before" | "after";
    onEnter: () => void;
    wait: Promise<void>;
  },
}));

vi.mock("@/main/api/services/chat.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/main/api/services/chat.service")>();
  return {
    ...actual,
    getMessagesAfterSeq: async (conversationId: string, afterSeq: number) => {
      const gate = h.gate;
      if (gate?.when === "before") {
        gate.onEnter();
        await gate.wait;
      }
      const rows = await actual.getMessagesAfterSeq(conversationId, afterSeq);
      if (gate?.when === "after") {
        gate.onEnter();
        await gate.wait;
      }
      return rows;
    },
  };
});

const { app } = await import("@/main/api");
const {
  addMessage,
  convertUserPromptToSDKMessage,
  createConversation,
  deleteMessage,
  getMessagesAfterSeq,
} = await import("@/main/api/services/chat.service");

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values({ id: workspaceId, name: "resume" });
});

const newConversation = async () => {
  const created = await createConversation(workspaceId);
  if (created.isErr()) throw new Error("failed to create conversation");
  return created.value.id;
};

const send = async (conversationId: string, text: string): Promise<Message> => {
  const id = crypto.randomUUID();
  const added = await addMessage({
    id,
    conversationId,
    messageType: "user_prompt",
    sdkMessage: convertUserPromptToSDKMessage(text, id),
  });
  if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
  return added.value;
};

const textOf = (m: Message) => {
  const content = (m.sdkMessage as { message: { content: unknown } }).message
    .content;
  return typeof content === "string"
    ? content
    : (content as { text?: string }[]).map((b) => b.text ?? "").join("");
};

// Opens the route and hands back a frame-at-a-time reader. The abort controller
// is the real one the route listens on, so closing actually detaches the
// backend listeners rather than leaking them into the next test.
const openStream = async (path: string) => {
  const abort = new AbortController();
  const res = await app.request(path, { signal: abort.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const queue: StreamEvent[] = [];
  let buf = "";

  const next = async (): Promise<StreamEvent> => {
    while (queue.length === 0) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the expected event");
      buf += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, split);
        buf = buf.slice(split + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (line) queue.push(JSON.parse(line.slice(5).trim()) as StreamEvent);
      }
    }
    return queue.shift()!;
  };

  const take = async (count: number) => {
    const events: StreamEvent[] = [];
    for (let i = 0; i < count; i++) events.push(await next());
    return events;
  };

  return {
    res,
    next,
    take,
    close: () => {
      abort.abort();
      void reader.cancel().catch(() => {});
    },
  };
};

// The three seeds, in the order the route sends them.
const SEEDS = ["state", "queue", "livePartial"] as const;

const messageTexts = (events: StreamEvent[]) =>
  events
    .filter((e): e is Extract<StreamEvent, { type: "message" }> =>
      e.type === "message",
    )
    .map((e) => textOf(e.message));

const holdGate = (when: "before" | "after") => {
  let release!: () => void;
  let entered!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const reached = new Promise<void>((r) => {
    entered = r;
  });
  h.gate = { when, onEnter: entered, wait };
  return {
    reached,
    release: () => {
      release();
      h.gate = null;
    },
  };
};

describe("getMessagesAfterSeq", () => {
  test("is exclusive: the caller's own last seq is not sent back", async () => {
    const conversationId = await newConversation();
    const a = await send(conversationId, "a");
    const b = await send(conversationId, "b");
    const c = await send(conversationId, "c");

    expect(
      (await getMessagesAfterSeq(conversationId, a.seq)).map(textOf),
    ).toEqual(["b", "c"]);
    expect(
      (await getMessagesAfterSeq(conversationId, c.seq)).map(textOf),
    ).toEqual([]);
    expect((await getMessagesAfterSeq(conversationId, 0)).map(textOf)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  test("stays inside the conversation", async () => {
    const mine = await newConversation();
    const theirs = await newConversation();
    await send(mine, "mine");
    await send(theirs, "theirs");

    expect((await getMessagesAfterSeq(mine, 0)).map(textOf)).toEqual(["mine"]);
  });

  test("a withdrawn message leaves a gap rather than a repeat", async () => {
    const conversationId = await newConversation();
    const first = await send(conversationId, "first");
    const cancelled = await send(conversationId, "cancelled");
    await deleteMessage(cancelled.id);
    const next = await send(conversationId, "next");

    // The cursor a client stopped at can name a row that no longer exists.
    // AUTOINCREMENT is what keeps that harmless: nothing was renumbered into
    // its place, so resuming from it still means "everything after".
    expect(next.seq).toBeGreaterThan(cancelled.seq);
    expect(
      (await getMessagesAfterSeq(conversationId, first.seq)).map(textOf),
    ).toEqual(["next"]);
  });
});

describe("stream replay", () => {
  test("afterSeq replays the transcript past it, then seeds", async () => {
    const conversationId = await newConversation();
    const a = await send(conversationId, "a");
    await send(conversationId, "b");
    await send(conversationId, "c");

    const stream = await openStream(
      `/api/chat/${conversationId}/stream?afterSeq=${a.seq}`,
    );
    try {
      const events = await stream.take(5);
      expect(messageTexts(events)).toEqual(["b", "c"]);
      expect(events.slice(2).map((e) => e.type)).toEqual([...SEEDS]);
    } finally {
      stream.close();
    }
  });

  test("no afterSeq means no replay — only the seeds", async () => {
    const conversationId = await newConversation();
    await send(conversationId, "a");
    await send(conversationId, "b");

    const stream = await openStream(`/api/chat/${conversationId}/stream`);
    try {
      const events = await stream.take(3);
      expect(events.map((e) => e.type)).toEqual([...SEEDS]);

      // Live events still flow; it is only the backlog that is withheld.
      const written = await send(conversationId, "live");
      expect(await stream.next()).toMatchObject({
        type: "message",
        message: { id: written.id },
      });
    } finally {
      stream.close();
    }
  });

  test("the seeds land after the backlog, not before it", async () => {
    const conversationId = await newConversation();
    await send(conversationId, "a");

    const stream = await openStream(
      `/api/chat/${conversationId}/stream?afterSeq=0`,
    );
    try {
      // A livePartial seeded ahead of the backlog would be wiped by the
      // renderer reacting to an assistant message older than it.
      expect((await stream.take(4)).map((e) => e.type)).toEqual([
        "message",
        ...SEEDS,
      ]);
    } finally {
      stream.close();
    }
  });

  test("a message written after the read still arrives — in order", async () => {
    const conversationId = await newConversation();
    const a = await send(conversationId, "a");
    await send(conversationId, "b");

    const gate = holdGate("after");
    const stream = await openStream(
      `/api/chat/${conversationId}/stream?afterSeq=${a.seq}`,
    );
    try {
      await gate.reached;
      // The backlog is already read and does not contain this. Only the
      // listener attached before the read can still be holding it.
      const missed = await send(conversationId, "missed");
      gate.release();

      const events = await stream.take(5);
      expect(messageTexts(events)).toEqual(["b", "missed"]);
      expect(events.map((e) => e.type)).toEqual([
        "message",
        ...SEEDS,
        "message",
      ]);
      expect(events.at(-1)).toMatchObject({ message: { id: missed.id } });
    } finally {
      stream.close();
    }
  });

  test("a message in both the backlog and the buffer is sent once", async () => {
    const conversationId = await newConversation();
    const a = await send(conversationId, "a");
    const b = await send(conversationId, "b");

    const gate = holdGate("before");
    const stream = await openStream(
      `/api/chat/${conversationId}/stream?afterSeq=${a.seq}`,
    );
    try {
      await gate.reached;
      // Written before the read, so the backlog carries it; emitted after the
      // attach, so the buffer carries it too.
      conversationEvents.emit("message", conversationId, { message: b });
      gate.release();

      const events = await stream.take(4);
      expect(messageTexts(events)).toEqual(["b"]);
      expect(events.map((e) => e.type)).toEqual(["message", ...SEEDS]);

      // Nothing queued behind the seeds: the next frame is the new write, not
      // a second copy of b.
      const after = await send(conversationId, "after");
      expect(await stream.next()).toMatchObject({
        type: "message",
        message: { id: after.id },
      });
    } finally {
      stream.close();
    }
  });

  test("rejects an afterSeq that is not a whole count", async () => {
    const conversationId = await newConversation();
    const res = await app.request(
      `/api/chat/${conversationId}/stream?afterSeq=-1`,
    );
    expect(res.status).toBe(400);
  });
});

import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, vi } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import type { Message, StreamEvent } from "@/main/api";
import {
  conversationEvents,
  openHandle,
  applyPartial,
  releaseHandle,
} from "@/main/lib/conversation-store";
import { buildPrompt } from "@/main/api/claude-code-ops";

// The backlog read is the only asynchronous step between attaching the
// listener and sending the seeds, so it is where the interesting interleavings
// live. The gate stops the route inside that step — `before` the read, so a
// message written during the pause is BOTH in the backlog and sent live;
// `after` it, so the same message is ONLY sent live. The second is the window
// that attaching-before-reading exists to cover: read first and that message
// reaches nobody.
const h = vi.hoisted(() => ({
  gate: null as null | {
    when: "before" | "after";
    onEnter: () => void;
    wait: Promise<void>;
  },
  // How the backlog read fails, when it should. "err" is the shape the real
  // service produces on a DB error; "reject" is the shape it must never
  // produce again — kept here so a test can pin what the route does if it
  // ever does.
  failure: null as null | "err" | "reject",
}));

vi.mock("@/main/api/services/chat.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/main/api/services/chat.service")>();
  const { err } = await import("neverthrow");
  return {
    ...actual,
    getMessagesAfterSeq: async (conversationId: string, afterSeq: number) => {
      if (h.failure === "reject") {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      if (h.failure === "err") {
        return err({
          status: 500 as const,
          code: "DB_ERROR",
          message: "Failed to read the transcript after the cursor",
        });
      }
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

// The service returns a Result; these tests are about the query itself, so an
// err is a test failure, not a case.
const rowsAfter = async (conversationId: string, afterSeq: number) => {
  const res = await getMessagesAfterSeq(conversationId, afterSeq);
  if (res.isErr()) {
    throw new Error(`getMessagesAfterSeq failed: ${res.error.code}`);
  }
  return res.value;
};

describe("getMessagesAfterSeq", () => {
  test("is exclusive: the caller's own last seq is not sent back", async () => {
    const conversationId = await newConversation();
    const a = await send(conversationId, "a");
    const b = await send(conversationId, "b");
    const c = await send(conversationId, "c");

    expect(
      (await rowsAfter(conversationId, a.seq)).map(textOf),
    ).toEqual(["b", "c"]);
    expect(
      (await rowsAfter(conversationId, c.seq)).map(textOf),
    ).toEqual([]);
    expect((await rowsAfter(conversationId, 0)).map(textOf)).toEqual([
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

    expect((await rowsAfter(mine, 0)).map(textOf)).toEqual(["mine"]);
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
      (await rowsAfter(conversationId, first.seq)).map(textOf),
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

  test("a message written after the read still arrives — ahead of the backlog", async () => {
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
      // listener attached before the read can still deliver it — and it does
      // so immediately, so it lands before the backlog the route is still
      // waiting on. The renderer orders by seq; the wire does not.
      const missed = await send(conversationId, "missed");
      gate.release();

      const events = await stream.take(5);
      expect(messageTexts(events)).toEqual(["missed", "b"]);
      expect(events.map((e) => e.type)).toEqual([
        "message",
        "message",
        ...SEEDS,
      ]);
    } finally {
      stream.close();
    }
  });

  test("a message in both the backlog and the live feed is sent twice, and nothing is dropped", async () => {
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
      // attach, so it goes out live too. The overlap is the accepted cost of
      // never having a gap — the renderer dedups by id.
      conversationEvents.emit("message", conversationId, { message: b });
      gate.release();

      const events = await stream.take(5);
      expect(messageTexts(events)).toEqual(["b", "b"]);
      expect(events.map((e) => e.type)).toEqual([
        "message",
        "message",
        ...SEEDS,
      ]);

      // Nothing queued behind the seeds: the next frame is the new write.
      const after = await send(conversationId, "after");
      expect(await stream.next()).toMatchObject({
        type: "message",
        message: { id: after.id },
      });
    } finally {
      stream.close();
    }
  });

  test("the seeds describe the state at the end of the read, not the start", async () => {
    const conversationId = await newConversation();
    openHandle(conversationId, buildPrompt("hi", { uuid: crypto.randomUUID() }));

    const gate = holdGate("after");
    const stream = await openStream(
      `/api/chat/${conversationId}/stream?afterSeq=0`,
    );
    try {
      await gate.reached;
      // A block starts streaming while the route is inside the read. Its
      // delta goes out live, ahead of the seeds; the seed that follows must
      // already contain it, or the renderer would overwrite the delta with an
      // older, emptier fold.
      const raw = {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "mid-read" },
      };
      applyPartial(conversationId, { type: "stream_event", event: raw } as never);
      conversationEvents.emit("partial", conversationId, {
        partial: { type: "stream_event", event: raw } as never,
      });
      gate.release();

      const events = await stream.take(4);
      expect(events.map((e) => e.type)).toEqual(["partial", ...SEEDS]);
      expect(events.at(-1)).toMatchObject({
        type: "livePartial",
        livePartial: { block: { type: "text", text: "mid-read" } },
      });
    } finally {
      stream.close();
      releaseHandle(conversationId);
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

describe("stream teardown", () => {
  // The route hangs its detach on two endings because the one these tests can
  // drive is not the one that fires in the app. Electron builds the
  // protocol.handle request without a signal, so `req.signal` never aborts
  // there; what a renderer-side fetch abort reaches is the response body.
  // Both are pinned here — deleting either hook fails one of these.
  test("cancelling the response body detaches the listeners", async () => {
    const conversationId = await newConversation();
    const before = conversationEvents.listenerCount("message");

    // No AbortSignal in play at all: this is the shipped path, where the only
    // thing that ever happens is the body being cancelled.
    const res = await app.request(`/api/chat/${conversationId}/stream`);
    const reader = res.body!.getReader();
    await reader.read(); // a seed — proof the handler attached
    expect(conversationEvents.listenerCount("message")).toBe(before + 1);

    await reader.cancel();

    expect(conversationEvents.listenerCount("message")).toBe(before);
  });

  test("aborting the request signal detaches them too", async () => {
    const conversationId = await newConversation();
    const before = conversationEvents.listenerCount("message");

    const abort = new AbortController();
    const res = await app.request(`/api/chat/${conversationId}/stream`, {
      signal: abort.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    expect(conversationEvents.listenerCount("message")).toBe(before + 1);

    // The signal and nothing else. openStream's close() cancels the body too,
    // which would let onAbort answer for this and leave the signal hook
    // untested — the body is deliberately left alone here.
    abort.abort();

    await vi.waitFor(() => {
      expect(conversationEvents.listenerCount("message")).toBe(before);
    });

    await reader.cancel().catch(() => {});
  });

  test("a failed backlog read skips the replay and stays live", async () => {
    const conversationId = await newConversation();
    await send(conversationId, "unreachable backlog");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failure = "err";
    const stream = await openStream(
      `/api/chat/${conversationId}/stream?afterSeq=0`,
    );
    try {
      // No message frames: the replay is skipped, not retried and not fatal.
      // The seeds still describe the present, and the live half still works —
      // the client's cursor only advances on a clean end, so the rows this
      // read owed it are owed by the next attach instead.
      const events = await stream.take(3);
      expect(events.map((e) => e.type)).toEqual([...SEEDS]);

      const after = await send(conversationId, "after the failure");
      expect(await stream.next()).toMatchObject({
        type: "message",
        message: { id: after.id },
      });
    } finally {
      h.failure = null;
      errorLog.mockRestore();
      stream.close();
    }
  });

  test("a backlog read that rejects unwinds without leaking the subscriber", async () => {
    const conversationId = await newConversation();
    const before = conversationEvents.listenerCount("message");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failure = "reject";
    try {
      // The service contract says this cannot happen — getMessagesAfterSeq
      // returns a Result — so this pins the finally, not the err branch: if
      // a rejection ever does unwind the handler, Hono catches it and CLOSES
      // the stream (close, not abort), so neither teardown hook fires and
      // only the finally stands between the subscriber and a process-lifetime
      // leak.
      const res = await app.request(
        `/api/chat/${conversationId}/stream?afterSeq=0`,
      );
      expect(await res.text()).toBe(""); // body ended cleanly, nothing sent

      expect(conversationEvents.listenerCount("message")).toBe(before);
    } finally {
      h.failure = null;
      errorLog.mockRestore();
    }
  });
});

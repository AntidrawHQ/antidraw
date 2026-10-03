// Imported FIRST: relocates ~/.antidraw to a fresh tmp dir — see e2e-env.ts.
import "./e2e-env";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, afterEach } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/main/db";
import { runTurn } from "@/main/api/turn";
import type { Conversation } from "@/main/api/models/chat.model";
import { workspaces, conversations } from "@/main/api/schema";
import { buildPrompt } from "@/main/api/claude-code-ops";
import {
  subscribe,
  getHandle,
  getStreamStatus,
  openHandle,
  releaseHandle,
  addPending,
} from "@/main/lib/conversation-store";

beforeAll(async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../db/drizzle", import.meta.url),
  );
  await migrate(db, { migrationsFolder });
});

// A conversation the store accepts but the DB has never seen: addMessage
// fails on the foreign key, so runTurn bails before anything spawns the CLI.
// The events emitted up to that point are exactly what a renderer would
// have drawn.
const ghost = (id: string): Conversation =>
  ({ id, workspaceId: "missing", claudeCodeSessionId: null }) as Conversation;

const detach: Array<() => void> = [];
afterEach(() => detach.splice(0).forEach((off) => off()));

const capture = (conversationId: string) => {
  const queues: string[][] = [];
  const errors: string[] = [];
  detach.push(
    subscribe(conversationId, (event) => {
      if (event.type === "queue") queues.push([...event.userMessageIds]);
      if (event.type === "error") errors.push(event.error);
    }),
  );
  return { queues, errors };
};

describe("runTurn and the pending set", () => {
  test("the cold-start prompt is never queued, and a failed persist is not silent", async () => {
    const conversationId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const { queues, errors } = capture(conversationId);

    await runTurn({
      conversation: ghost(conversationId),
      workspaceId: "missing",
      message: "spawn prompt",
      userMessageId,
    });

    // The spawn prompt is what the CLI starts on — it must never appear in
    // a queue snapshot, not even transiently before the turn gave up.
    expect(queues.flat()).not.toContain(userMessageId);
    expect(getHandle(conversationId)).toBeUndefined(); // released on the bail

    // The POST already answered 202 and the renderer wrote "streaming";
    // only a wire event ends the turn on its side. Silence pins it there.
    expect(errors).toHaveLength(1);
    expect(getStreamStatus(conversationId)).toBe("error");
  });

  test("a follow-up is queued, then resolved when the persist fails — and the failure is reported", async () => {
    const conversationId = crypto.randomUUID();
    openHandle(conversationId, buildPrompt("first", { uuid: crypto.randomUUID() }));
    const { queues, errors } = capture(conversationId);

    const userMessageId = crypto.randomUUID();
    await runTurn({
      conversation: ghost(conversationId),
      workspaceId: "missing",
      message: "follow-up",
      userMessageId,
    });

    // Queued the moment it was accepted, resolved when the persist failed —
    // the bubble never sticks at "Queued", and the drop is announced.
    expect(queues).toEqual([[userMessageId], []]);
    expect(errors).toHaveLength(1);
    releaseHandle(conversationId);
  });

  test("a follow-up the stream can no longer accept is resolved and reported", async () => {
    // Real rows this time: the persist succeeds and the turn reaches the push.
    const workspaceId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: "run-turn" });
    await db.insert(conversations).values({ id: conversationId, workspaceId });

    const stream = buildPrompt("first", { uuid: crypto.randomUUID() });
    openHandle(conversationId, stream);
    stream.end(); // the owning loop is gone — the push must fail

    const { queues, errors } = capture(conversationId);
    const userMessageId = crypto.randomUUID();
    await runTurn({
      conversation: {
        id: conversationId,
        workspaceId,
        claudeCodeSessionId: null,
      } as Conversation,
      workspaceId,
      message: "late follow-up",
      userMessageId,
    });

    expect(queues).toEqual([[userMessageId], []]);
    expect(errors).toHaveLength(1);
    releaseHandle(conversationId);
  });

  test("a dying turn clears the queue before the terminal error, not after", async () => {
    // Real rows so the persist succeeds and the turn reaches runColdStart —
    // but no workspace directory on disk, so the CLI spawn fails and the
    // turn dies in the catch. No CLI runs.
    const workspaceId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: "run-turn" });
    await db.insert(conversations).values({ id: conversationId, workspaceId });

    // One ordered log: the renderer treats `error` as terminal and closes
    // the stream, so anything emitted after it is never delivered.
    const log: Array<{ type: string; ids?: string[] }> = [];
    detach.push(
      subscribe(conversationId, (event) => {
        if (event.type === "queue")
          log.push({ type: "queue", ids: [...event.userMessageIds] });
        if (event.type === "error") log.push({ type: "error" });
      }),
    );

    const turn = runTurn({
      conversation: {
        id: conversationId,
        workspaceId,
        claudeCodeSessionId: null,
      } as Conversation,
      workspaceId,
      message: "doomed cold start",
      userMessageId: crypto.randomUUID(),
    });
    // Queue a follow-up behind the dying turn, the way a second send would.
    const followUpId = crypto.randomUUID();
    addPending(conversationId, followUpId);
    await turn;

    // The follow-up was queued, then cleared — and the clear crossed the
    // wire BEFORE the terminal error. If `error` is not the last event,
    // the queue: [] snapshot was written to a stream nobody reads and the
    // follow-up's bubble stays "Queued".
    expect(log).toContainEqual({ type: "queue", ids: [followUpId] });
    expect(log).toContainEqual({ type: "queue", ids: [] });
    expect(log[log.length - 1]).toEqual({ type: "error" });
  });
});

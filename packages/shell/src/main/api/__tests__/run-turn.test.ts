// Imported FIRST: relocates ~/.antidraw to a fresh tmp dir — see e2e-env.ts.
import "./e2e-env";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, afterEach } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/main/db";
import { runTurn } from "@/main/api/turn";
import type { Conversation } from "@/main/api/models/chat.model";
import { buildPrompt } from "@/main/api/claude-code-ops";
import {
  subscribe,
  getHandle,
  openHandle,
  releaseHandle,
} from "@/main/lib/conversation-store";

beforeAll(async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../db/drizzle", import.meta.url),
  );
  await migrate(db, { migrationsFolder });
});

// A conversation the store accepts but the DB has never seen: addMessage
// fails on the foreign key, so runTurn bails before anything spawns the CLI.
// The queue events emitted up to that point are exactly what a renderer
// would have drawn.
const ghost = (id: string): Conversation =>
  ({ id, workspaceId: "missing", claudeCodeSessionId: null }) as Conversation;

const detach: Array<() => void> = [];
afterEach(() => detach.splice(0).forEach((off) => off()));

const captureQueues = (conversationId: string) => {
  const seen: string[][] = [];
  detach.push(
    subscribe(conversationId, (event) => {
      if (event.type === "queue") seen.push([...event.userMessageIds]);
    }),
  );
  return seen;
};

describe("runTurn and the pending set", () => {
  test("the cold-start prompt is never queued", async () => {
    const conversationId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const queues = captureQueues(conversationId);

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
  });

  test("a follow-up is queued, then resolved when the turn gives up on it", async () => {
    const conversationId = crypto.randomUUID();
    openHandle(conversationId, buildPrompt("first", { uuid: crypto.randomUUID() }));
    const queues = captureQueues(conversationId);

    const userMessageId = crypto.randomUUID();
    await runTurn({
      conversation: ghost(conversationId),
      workspaceId: "missing",
      message: "follow-up",
      userMessageId,
    });

    // Queued the moment it was accepted, resolved when the persist failed —
    // the bubble never sticks at "Queued".
    expect(queues).toEqual([[userMessageId], []]);
    releaseHandle(conversationId);
  });
});

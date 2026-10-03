import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "@/main/api";
import type { ConversationWithMessages } from "@/main/api";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import { getHandle } from "@/main/lib/conversation-store";

const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();

// Real everything: this spawns the bundled Claude CLI (local auth session,
// model haiku) and lets the full POST → owner loop → SQLite → GET path run.
const MODEL = "haiku";

const getConversation = async (id: string): Promise<ConversationWithMessages> => {
  const res = await app.request(`/api/chat/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ConversationWithMessages;
};

const until = async <T>(
  probe: () => Promise<T | null>,
  what: string,
  timeoutMs = 90_000,
  everyMs = 400,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
};

beforeAll(async () => {
  const migrationsFolder = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
  await migrate(db, { migrationsFolder });
  await db.insert(workspaces).values({ id: workspaceId, name: "e2e" });
  // The CLI's cwd — must exist for the spawn to succeed.
  mkdirSync(path.join(ROOT, "workspaces", workspaceId, "source"), { recursive: true });
});

// Root cleanup lives in e2e-env.ts (an exit handler, gated on whether the
// harness minted the directory) — never here, where a preset ANTIDRAW_ROOT
// pointing at a real profile would be deleted.

describe("POST /api/chat/message", () => {
  test("a message travels end to end: POST → CLI → DB → GET", { timeout: 120_000 }, async () => {
    const userMessageId = crypto.randomUUID();

    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Reply with exactly: done",
        workspaceId,
        userMessageId,
        model: MODEL,
      }),
    });

    expect(res.status).toBe(202);
    const { conversationId } = (await res.json()) as { conversationId: string };
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

    // The turn is over when the CLI said idle (streamStatus derives from it)
    // and the result row has landed.
    const conversation = await until(async () => {
      const c = await getConversation(conversationId);
      const done =
        c.streamStatus === "idle" &&
        c.messages.some((m) => m.sdkMessage.type === "result");
      return done ? c : null;
    }, "turn to complete");

    // The prompt: exactly one row, under the frontend-assigned id.
    const prompts = conversation.messages.filter((m) => m.messageType === "user_prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.id).toBe(userMessageId);

    // The reply: at least one assistant row, on the model we selected.
    const assistants = conversation.messages.filter(
      (m) => m.sdkMessage.type === "assistant",
    );
    expect(assistants.length).toBeGreaterThanOrEqual(1);
    for (const a of assistants) {
      expect((a.sdkMessage as { message: { model: string } }).message.model).toContain(
        "haiku",
      );
    }
    expect(JSON.stringify(assistants.map((a) => a.sdkMessage))).toContain("done");

    // Exactly one turn result, successful.
    const results = conversation.messages.filter((m) => m.sdkMessage.type === "result");
    expect(results).toHaveLength(1);
    expect((results[0]!.sdkMessage as { subtype: string }).subtype).toBe("success");

    // Lifecycle facts consumed in memory are NOT rows (today's contract).
    const types = conversation.messages.map(
      (m) => (m.sdkMessage as { type: string; subtype?: string }).subtype ?? m.sdkMessage.type,
    );
    expect(types).not.toContain("session_state_changed");
    expect(conversation.messages.some((m) => m.sdkMessage.type === "stream_event")).toBe(false);

    // The conversation row captured the session and the selection snapshot.
    expect(conversation.claudeCodeSessionId).toBeTruthy();
    expect(conversation.selectedModel).toBe(MODEL);

    // Teardown: close the input stream — the CLI exits, the owning loop's
    // finally unregisters the stream. Keeps vitest from hanging on the
    // keep-alive loop.
    getHandle(conversationId)?.promptStream.end();
    await until(
      async () => (getHandle(conversationId) === undefined ? true : null),
      "stream teardown",
      20_000,
    );
  });
});

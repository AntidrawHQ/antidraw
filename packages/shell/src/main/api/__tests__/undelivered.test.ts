import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UUID } from "node:crypto";
import { describe, test, expect, beforeAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import { app } from "@/main/api";
import { db } from "@/main/db";
import * as schema from "@/main/api/schema";
import { conversations, messages, workspaces } from "@/main/api/schema";
import {
  addMessage,
  convertUserPromptToSDKMessage,
  createConversation,
  markDelivered,
} from "@/main/api/services/chat.service";
import {
  addPending,
  clearPending,
  openHandle,
  releaseHandle,
  resolvePending,
} from "@/main/lib/conversation-store";
import { buildPrompt } from "@/main/api/claude-code-ops";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values({ id: workspaceId, name: "undelivered" });
});

const newConversation = async () => {
  const created = await createConversation(workspaceId);
  if (created.isErr()) throw new Error("failed to create conversation");
  return created.value.id;
};

// A prompt row the way runTurn writes it: persisted, delivered_at null.
const persistPrompt = async (conversationId: string) => {
  const id = crypto.randomUUID();
  const added = await addMessage({
    id,
    conversationId,
    messageType: "user_prompt",
    sdkMessage: convertUserPromptToSDKMessage("x", id as UUID),
  });
  if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
  return id;
};

// The CLI's ack, the way the turn loop records it.
const ack = async (conversationId: string, id: string) => {
  const marked = await markDelivered(id);
  if (marked.isErr()) throw new Error("markDelivered failed");
  resolvePending(conversationId, id);
};

const failed = async (conversationId: string): Promise<string[]> => {
  const res = await app.request(`/api/chat/${conversationId}/undelivered`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { failedUserMessageIds: string[] };
  return body.failedUserMessageIds;
};

describe("GET /chat/:conversationId/undelivered", () => {
  test("a prompt is failed only with no ack on record and no handle holding it", async () => {
    const id = await newConversation();
    openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));

    const a = await persistPrompt(id);
    const b = await persistPrompt(id);
    const c = await persistPrompt(id);
    addPending(id, a);
    addPending(id, b);
    addPending(id, c);
    await ack(id, c);
    // The row outlived its pending entry without an ack — what a dead push
    // leaves behind.
    const d = await persistPrompt(id);

    // a, b: queued. c: delivered. d: failed.
    expect(await failed(id)).toEqual([d]);

    await ack(id, a);
    expect(await failed(id)).toEqual([d]);

    // The loop dies: every pending id is dropped on the way out.
    clearPending(id);
    releaseHandle(id);
    expect(await failed(id)).toEqual([b, d]);
  });

  test("with no handle at all, every un-acked prompt is failed", async () => {
    // A restart: whatever was queued died with the process, and nothing is
    // left in memory to say so. The column alone answers.
    const id = await newConversation();
    const a = await persistPrompt(id);
    const b = await persistPrompt(id);
    const marked = await markDelivered(a);
    if (marked.isErr()) throw new Error("markDelivered failed");

    expect(await failed(id)).toEqual([b]);
  });

  test("sdk_message rows are never reported, whatever their column says", async () => {
    const id = await newConversation();
    const added = await addMessage({
      conversationId: id,
      messageType: "sdk_message",
      sdkMessage: {
        type: "assistant",
        uuid: crypto.randomUUID(),
        session_id: "s",
        message: { role: "assistant", content: [] },
        parent_tool_use_id: null,
      } as never,
    });
    if (added.isErr()) throw new Error("addMessage failed");

    expect(await failed(id)).toEqual([]);
  });

  test("a conversation that never queued anything reports nothing", async () => {
    expect(await failed(await newConversation())).toEqual([]);
  });
});

describe("migration 0005", () => {
  const stageTo = (dir: string, upTo: number) => {
    mkdirSync(path.join(dir, "meta"), { recursive: true });
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter((e) => e.idx <= upTo);
    for (const e of entries) {
      cpSync(
        path.join(MIGRATIONS, `${e.tag}.sql`),
        path.join(dir, `${e.tag}.sql`),
      );
    }
    writeFileSync(
      path.join(dir, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
  };

  test("stamps every existing prompt as delivered, and only prompts", async () => {
    // Every prompt persisted before the column existed ran — the CLI had no
    // other way to leave it in the DB. Without the backfill, all of them
    // would read "Not delivered" on first launch after the upgrade.
    const dir = path.join(ROOT, "migration-0005");
    const staged = path.join(dir, "staged");
    mkdirSync(dir, { recursive: true });
    const legacy = drizzle(
      createClient({ url: `file:${path.join(dir, "legacy.db")}` }),
      { schema },
    );

    stageTo(staged, 4);
    await migrate(legacy, { migrationsFolder: staged });
    await legacy.insert(workspaces).values({ id: "w", name: "legacy" });
    await legacy.insert(conversations).values({ id: "c", workspaceId: "w" });
    await legacy.run(
      sql`INSERT INTO messages (id, conversation_id, message_type, sdk_message, created_at)
          VALUES ('p1', 'c', 'user_prompt', '{}', 1700000000000),
                 ('a1', 'c', 'sdk_message', '{}', 1700000001000),
                 ('p2', 'c', 'user_prompt', '{}', 1700000002000)`,
    );

    stageTo(staged, 5);
    await migrate(legacy, { migrationsFolder: staged });

    const rows = await legacy
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        deliveredAt: messages.deliveredAt,
      })
      .from(messages)
      .orderBy(messages.seq);

    expect(
      rows.map((r) => ({
        id: r.id,
        deliveredAt: r.deliveredAt?.getTime() ?? null,
      })),
    ).toEqual([
      { id: "p1", deliveredAt: 1700000000000 },
      { id: "a1", deliveredAt: null },
      { id: "p2", deliveredAt: 1700000002000 },
    ]);
  });
});

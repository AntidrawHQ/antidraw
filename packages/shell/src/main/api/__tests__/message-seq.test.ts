import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UUID } from "node:crypto";
import { describe, test, expect, beforeAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, sql } from "drizzle-orm";
import { db } from "@/main/db";
import type { ConversationWithMessages } from "@/main/api";
import * as schema from "@/main/api/schema";
import { conversations, messages, workspaces } from "@/main/api/schema";
import {
  addMessage,
  convertUserPromptToSDKMessage,
  deleteMessage,
  getConversation,
  createConversation,
} from "@/main/api/services/chat.service";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values({ id: workspaceId, name: "seq" });
});

const newConversation = async () => {
  const created = await createConversation(workspaceId);
  if (created.isErr()) throw new Error("failed to create conversation");
  return created.value.id;
};

const send = async (conversationId: string, text: string) => {
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

const transcript = async (conversationId: string) => {
  const res = await getConversation(conversationId, { includeMessages: true });
  if (res.isErr()) throw new Error("conversation not found");
  // getConversation's return type does not narrow on includeMessages.
  return (res.value as ConversationWithMessages).messages;
};

const textOf = (m: { sdkMessage: unknown }) => {
  const content = (m.sdkMessage as { message: { content: unknown } }).message
    .content;
  return typeof content === "string"
    ? content
    : (content as { text?: string }[]).map((b) => b.text ?? "").join("");
};

describe("seq", () => {
  test("the DB assigns it, ascending, and hands it back from addMessage", async () => {
    const conversationId = await newConversation();
    const a = await send(conversationId, "a");
    const b = await send(conversationId, "b");
    const c = await send(conversationId, "c");

    expect(a.seq).toBeTypeOf("number");
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  test("is never reused after a queued message is withdrawn", async () => {
    const conversationId = await newConversation();
    const first = await send(conversationId, "first");
    const cancelled = await send(conversationId, "cancelled");

    const deleted = await deleteMessage(cancelled.id);
    expect(deleted.isOk()).toBe(true);

    const next = await send(conversationId, "next");
    expect(next.seq).toBeGreaterThan(cancelled.seq);
    expect(next.seq).not.toBe(cancelled.seq);
    expect(first.seq).toBeLessThan(cancelled.seq);
  });

  test("orders the transcript when every row shares one createdAt", async () => {
    const conversationId = await newConversation();
    for (const text of ["one", "two", "three", "four"]) {
      await send(conversationId, text);
    }

    // The real-world case: createdAt defaults to whole seconds, so a turn's
    // messages routinely land on the same value. Pinned here so the test does
    // not depend on how fast the inserts happen to run.
    await db
      .update(messages)
      .set({ createdAt: new Date(1_700_000_000_000) })
      .where(eq(messages.conversationId, conversationId));

    expect((await transcript(conversationId)).map(textOf)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  test("outranks createdAt when the two disagree", async () => {
    const conversationId = await newConversation();
    for (const text of ["one", "two", "three"]) {
      await send(conversationId, text);
    }

    // createdAt written backwards. Ordering by it would reverse the
    // transcript, so this fails unless seq is what the query sorts on.
    await db.run(
      sql`UPDATE ${messages} SET created_at = 1700000003000 - seq
          WHERE conversation_id = ${conversationId}`,
    );

    expect((await transcript(conversationId)).map(textOf)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  test("a duplicate id is still reported as DUPLICATE_ID", async () => {
    const conversationId = await newConversation();
    const first = await send(conversationId, "original");

    // id moved from primary key to a unique column, which changed the
    // constraint name libsql reports. This is that path.
    const again = await addMessage({
      id: first.id,
      conversationId,
      messageType: "user_prompt",
      sdkMessage: convertUserPromptToSDKMessage("duplicate", first.id as UUID),
    });

    expect(again.isErr()).toBe(true);
    expect(again._unsafeUnwrapErr().code).toBe("DUPLICATE_ID");
  });
});

describe("migration 0004", () => {
  // The rebuild statement is hand-patched (drizzle-kit copies a rebuild
  // column-for-column and cannot know seq is new), so it gets exercised
  // rather than trusted: migrate to 0003, write rows the way the old schema
  // did, then let 0004 run over real data.
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

  test("assigns seq to existing rows in insertion order", async () => {
    const dir = path.join(ROOT, "migration-0004");
    const staged = path.join(dir, "staged");
    mkdirSync(dir, { recursive: true });
    const legacy = drizzle(
      createClient({ url: `file:${path.join(dir, "legacy.db")}` }),
      { schema },
    );

    stageTo(staged, 3);
    await migrate(legacy, { migrationsFolder: staged });

    await legacy.insert(workspaces).values({ id: "w", name: "legacy" });
    await legacy.insert(conversations).values({ id: "c", workspaceId: "w" });
    // Four rows sharing one second, written the way the pre-seq schema did:
    // no seq column to write to.
    for (const id of ["m1", "m2", "m3", "m4"]) {
      await legacy.run(
        sql`INSERT INTO messages (id, conversation_id, message_type, sdk_message, created_at)
            VALUES (${id}, 'c', 'user_prompt', '{}', 1700000000000)`,
      );
    }

    stageTo(staged, 4);
    await migrate(legacy, { migrationsFolder: staged });

    const rows = await legacy
      .select({ seq: messages.seq, id: messages.id })
      .from(messages)
      .orderBy(messages.seq);

    expect(rows).toEqual([
      { seq: 1, id: "m1" },
      { seq: 2, id: "m2" },
      { seq: 3, id: "m3" },
      { seq: 4, id: "m4" },
    ]);
  });
});

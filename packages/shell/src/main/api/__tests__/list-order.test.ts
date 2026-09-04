import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import type { UUID } from "node:crypto";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { db } from "@/main/db";
import { conversations, workspaces } from "@/main/api/schema";
import {
  addMessage,
  convertUserPromptToSDKMessage,
  createConversation,
  listConversations,
} from "@/main/api/services/chat.service";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values({ id: workspaceId, name: "list-order" });
});

const newConversation = async () => {
  const created = await createConversation(workspaceId);
  if (created.isErr()) throw new Error("failed to create conversation");
  return created.value.id;
};

const prompt = async (conversationId: string) => {
  const id = crypto.randomUUID();
  const added = await addMessage({
    id,
    conversationId,
    messageType: "user_prompt",
    sdkMessage: convertUserPromptToSDKMessage("x", id as UUID),
  });
  if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
};

const reply = async (conversationId: string) => {
  const added = await addMessage({
    conversationId,
    messageType: "sdk_message",
    sdkMessage: { type: "assistant" } as never,
  });
  if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
};

const updatedAt = async (conversationId: string) => {
  const [row] = await db
    .select({ updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  return row!.updatedAt.getTime();
};

const order = async () => {
  const listed = await listConversations(workspaceId);
  if (listed.isErr()) throw new Error("listConversations failed");
  return listed.value.map((c) => c.id);
};

// The row defaults are whole seconds; the bump writes milliseconds. A short
// wait keeps each step strictly later than the last without relying on either.
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("the sidebar order", () => {
  test("a user prompt moves its conversation to the top; a reply does not", async () => {
    // Both rows default to the same whole second, so their relative order is
    // a tie the schema promises nothing about. The first prompt breaks it.
    const a = await newConversation();
    const b = await newConversation();

    await tick();
    await prompt(a);
    expect(await order()).toEqual([a, b]);

    // The reply lands where the prompt put it.
    const before = await updatedAt(a);
    await tick();
    await reply(a);
    expect(await updatedAt(a)).toBe(before);
    expect(await order()).toEqual([a, b]);

    await tick();
    await prompt(b);
    expect(await order()).toEqual([b, a]);
  });

  test("the bump is later than the row's creation default", async () => {
    const a = await newConversation();
    const created = await updatedAt(a);
    await tick();
    await prompt(a);
    expect(await updatedAt(a)).toBeGreaterThan(created);
  });
});

import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import type { UUID } from "node:crypto";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { db } from "@/main/db";
import { messages, workspaces } from "@/main/api/schema";
import { workspaceController } from "@/main/api/controllers/workspace.controller";
import {
  addMessage,
  convertUserPromptToSDKMessage,
  createConversation,
} from "@/main/api/services/chat.service";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

// Made on different days, so each workspace's dates tell it apart.
const quiet = { id: crypto.randomUUID(), name: "quiet", createdAt: new Date("2026-03-01T10:00:00Z") };
const busy = { id: crypto.randomUUID(), name: "busy", createdAt: new Date("2026-02-01T10:00:00Z") };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values([quiet, busy]);
});

// A prompt in a new conversation of the workspace, written at `at`.
const promptAt = async (workspaceId: string, at: Date) => {
  const conversation = await createConversation(workspaceId);
  if (conversation.isErr()) throw new Error("failed to create conversation");
  const id = crypto.randomUUID();
  const added = await addMessage({
    id,
    conversationId: conversation.value.id,
    messageType: "user_prompt",
    sdkMessage: convertUserPromptToSDKMessage("x", id as UUID),
  });
  if (added.isErr()) throw new Error(`addMessage failed: ${added.error.code}`);
  await db.update(messages).set({ createdAt: at }).where(eq(messages.id, id));
};

const lastActive = async () => {
  const list: { id: string; lastActiveAt: number }[] = await (await workspaceController.request("/")).json();
  const one = async (id: string) => (await (await workspaceController.request(`/${id}`)).json()).lastActiveAt;
  const listed = (id: string) => new Date(list.find((w) => w.id === id)!.lastActiveAt).toISOString();
  // The list and the workspace on its own agree.
  expect(await one(quiet.id)).toBe(list.find((w) => w.id === quiet.id)!.lastActiveAt);
  expect(await one(busy.id)).toBe(list.find((w) => w.id === busy.id)!.lastActiveAt);
  return { quiet: listed(quiet.id), busy: listed(busy.id) };
};

describe("when a workspace was last active", () => {
  test("when it was made, until it has a message", async () => {
    expect(await lastActive()).toEqual({
      quiet: "2026-03-01T10:00:00.000Z",
      busy: "2026-02-01T10:00:00.000Z",
    });
  });

  test("its newest message, across its conversations, and no other workspace's", async () => {
    await promptAt(busy.id, new Date("2026-04-02T09:00:00Z"));
    await promptAt(busy.id, new Date("2026-04-05T09:00:00Z"));
    await promptAt(busy.id, new Date("2026-04-03T09:00:00Z"));

    expect(await lastActive()).toEqual({
      quiet: "2026-03-01T10:00:00.000Z",
      busy: "2026-04-05T09:00:00.000Z",
    });
  });
});

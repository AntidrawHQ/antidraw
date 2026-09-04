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
import { getHandle, getPartial } from "@/main/lib/conversation-store";

const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();
const CLI_TIMEOUT_MS = 200_000;

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
  });
  await db.insert(workspaces).values({ id: workspaceId, name: "interrupt-e2e" });
  mkdirSync(path.join(ROOT, "workspaces", workspaceId, "source"), { recursive: true });
});

const until = async <T>(
  probe: () => T | null | Promise<T | null>,
  what: string,
  timeoutMs = CLI_TIMEOUT_MS,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("stopping a turn mid-block", () => {
  test(
    "leaves no stale block behind for the next subscriber",
    { timeout: 300_000 },
    async () => {
      const res = await app.request("/api/chat/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message:
            "Write a 600 word essay about the sea. Prose only, start immediately.",
          workspaceId,
          userMessageId: crypto.randomUUID(),
          model: "haiku",
        }),
      });
      expect(res.status).toBe(202);
      const { conversationId } = (await res.json()) as { conversationId: string };

      // Wait until a block is genuinely accumulating, not merely started.
      const midBlock = await until(() => {
        const partial = getPartial(conversationId);
        const block = partial?.block as { text?: string; thinking?: string } | undefined;
        const grown = (block?.text ?? block?.thinking ?? "").length > 30;
        return grown ? partial : null;
      }, "a block to be streaming");
      expect(midBlock).not.toBeNull();

      const stop = await app.request(`/api/chat/${conversationId}/stream`, {
        method: "DELETE",
      });
      expect(await stop.json()).toEqual({ cancelled: true });

      // interrupt deliberately keeps the handle open, so this is not the
      // handle simply being torn down.
      await until(
        () => (getHandle(conversationId)?.cliState === "idle" ? true : null),
        "the CLI to settle back to idle",
      );
      expect(getHandle(conversationId)).toBeDefined();

      // The question this test exists to answer: nothing else clears the
      // block, because the CLI never persisted an assistant message for it.
      const conversation = (await (
        await app.request(`/api/chat/${conversationId}`)
      ).json()) as ConversationWithMessages;
      const persisted = conversation.messages
        .filter((m) => m.sdkMessage.type === "assistant")
        .map((m) => JSON.stringify(m.sdkMessage));
      // Same accessor as the probe above — a thinking block would otherwise
      // read as "" and make includes("") true for any assistant row.
      const b = midBlock!.block as { text?: string; thinking?: string };
      const abandoned = b.text ?? b.thinking ?? "";
      const wasPersisted =
        abandoned !== "" && persisted.some((p) => p.includes(abandoned.slice(0, 30)));
      console.error(
        `[interrupt] abandoned block persisted as an assistant message? ${wasPersisted}` +
          ` (assistant rows: ${persisted.length})`,
      );

      expect(getPartial(conversationId)).toBeNull();

      // A deliberate stop is not a failure. interrupt() is a control request,
      // not something that ends the stream: the CLI aborts the turn and stays
      // alive, so nothing enters runColdStart's catch, markError never runs,
      // and the next message goes into this same session as a follow-up.
      // Measured separately: the handle is still open 15s after an interrupt.
      expect(conversation.streamStatus).toBe("idle");
      expect(getHandle(conversationId)?.query).toBeTruthy();

      // Teardown only. end() closes stdin, so the CLI exits and the SDK
      // reports that exit as an error result — that log line belongs to the
      // teardown below, NOT to the interrupt above.
      getHandle(conversationId)?.promptStream.end();
      await until(
        () => (getHandle(conversationId) === undefined ? true : null),
        "teardown",
        20_000,
      );
    },
  );
});

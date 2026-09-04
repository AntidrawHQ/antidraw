import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import {
  handleSdkMessageWithoutPersisting,
  handleAndPersistSdkMessage,
} from "@/main/api/turn";
import { buildPrompt } from "@/main/api/claude-code-ops";
import { createConversation } from "@/main/api/services/chat.service";
import {
  openHandle,
  getPartial,
  setCliState,
  releaseHandle,
} from "@/main/lib/conversation-store";

const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
  });
  await db.insert(workspaces).values({ id: workspaceId, name: "live-partial" });
});

// Wire shapes the CLI actually emits. Real store, real fold — only input authored.
const start = (block: unknown, index = 0): SDKMessage =>
  ({
    type: "stream_event",
    event: { type: "content_block_start", index, content_block: block },
  }) as never;

const delta = (d: unknown, index = 0): SDKMessage =>
  ({
    type: "stream_event",
    event: { type: "content_block_delta", index, delta: d },
  }) as never;

let counter = 0;
const liveConversation = () => {
  const id = `partial-${counter++}`;
  openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));
  return id;
};

describe("the in-flight block", () => {
  test("accumulates text across deltas", async () => {
    const id = liveConversation();
    await handleSdkMessageWithoutPersisting(id, start({ type: "text", text: "" }));
    await handleSdkMessageWithoutPersisting(id, delta({ type: "text_delta", text: "Hel" }));
    await handleSdkMessageWithoutPersisting(id, delta({ type: "text_delta", text: "lo" }));

    expect(getPartial(id)).toMatchInlineSnapshot(`
      {
        "block": {
          "text": "Hello",
          "type": "text",
        },
        "index": 0,
        "partialJson": undefined,
      }
    `);
  });

  test("accumulates a tool_use's json and parses it while incomplete", async () => {
    const id = liveConversation();
    await handleSdkMessageWithoutPersisting(
      id,
      start({ type: "tool_use", id: "t1", name: "Read", input: {} }),
    );
    await handleSdkMessageWithoutPersisting(
      id,
      delta({ type: "input_json_delta", partial_json: '{"file_path":"/a' }),
    );

    // Parsed from truncated json — this is what makes a tool call render
    // before its arguments have finished arriving.
    expect(getPartial(id)).toMatchInlineSnapshot(`
      {
        "block": {
          "id": "t1",
          "input": {
            "file_path": "/a",
          },
          "name": "Read",
          "type": "tool_use",
        },
        "index": 0,
        "partialJson": "{"file_path":"/a",
      }
    `);
  });

  test("ignores a delta aimed at a different block", async () => {
    const id = liveConversation();
    await handleSdkMessageWithoutPersisting(id, start({ type: "text", text: "keep" }));
    await handleSdkMessageWithoutPersisting(
      id,
      delta({ type: "text_delta", text: "dropped" }, 7),
    );

    expect(getPartial(id)?.block).toEqual({ type: "text", text: "keep" });
  });

  test("is dropped when the CLI goes idle", async () => {
    const id = liveConversation();
    await handleSdkMessageWithoutPersisting(id, start({ type: "text", text: "x" }));
    expect(getPartial(id)).not.toBeNull();

    setCliState(id, "idle");
    expect(getPartial(id)).toBeNull();
  });

  test("is dropped once the assistant message it fed is persisted", async () => {
    const created = await createConversation(workspaceId);
    if (created.isErr()) throw new Error("failed to create conversation");
    const conversation = created.value;
    openHandle(conversation.id, buildPrompt("hi", { uuid: crypto.randomUUID() }));

    await handleSdkMessageWithoutPersisting(
      conversation.id,
      start({ type: "text", text: "streaming" }),
    );
    expect(getPartial(conversation.id)).not.toBeNull();

    await handleAndPersistSdkMessage(
      { conversation, sessionId: "s-1" },
      { type: "assistant", uuid: crypto.randomUUID(), message: {} } as never,
    );

    expect(getPartial(conversation.id)).toBeNull();
    releaseHandle(conversation.id);
  });

  test("is null once the handle is gone", async () => {
    const id = liveConversation();
    await handleSdkMessageWithoutPersisting(id, start({ type: "text", text: "x" }));
    releaseHandle(id);
    expect(getPartial(id)).toBeNull();
  });
});

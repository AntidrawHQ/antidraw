import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "@/main/api";
import type { ConversationWithMessages, StreamEvent } from "@/main/api";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import {
  getHandle,
  getPendingQuestionIds,
  subscribe,
} from "@/main/lib/conversation-store";
import { parseAskUserQuestionInput } from "@/shared/utils/ask-user-question";

// Real everything: the bundled CLI under bypassPermissions, asked to use
// AskUserQuestion. This is the claim the whole design rests on — that the
// question still reaches canUseTool in bypass mode — checked against the CLI
// rather than read out of its bundle.
const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();
const MODEL = "haiku";
const TIMEOUT = 180_000;

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
  });
  await db.insert(workspaces).values({ id: workspaceId, name: "ask-e2e" });
  mkdirSync(path.join(ROOT, "workspaces", workspaceId, "source"), { recursive: true });
});

const until = async <T>(
  probe: () => T | null | Promise<T | null>,
  what: string,
  timeoutMs = 120_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const getConversation = async (id: string) =>
  (await (await app.request(`/api/chat/${id}`)).json()) as ConversationWithMessages;

type Block = { type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown };
const blocksOf = (c: ConversationWithMessages) =>
  c.messages.flatMap((m) => {
    const s = m.sdkMessage;
    if (s.type !== "user" && s.type !== "assistant") return [];
    const content = s.message.content;
    return Array.isArray(content)
      ? (content as Block[]).map((block) => ({ block, sdkMessage: s }))
      : [];
  });

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: { text?: string }) => c.text ?? "").join("")
      : "";

// Starts a turn whose first act is a question, and waits until the CLI is
// blocked on it. Returns the question as the transcript holds it.
const askedTurn = async () => {
  const res = await app.request("/api/chat/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message:
        "Use the AskUserQuestion tool right now to ask me one question: which colour I prefer, " +
        "with exactly two options, Red and Blue (single select). Do nothing else first. " +
        "After I answer, reply with only the colour I chose, in lowercase. " +
        "If I do not answer, reply with only the word: skipped",
      workspaceId,
      userMessageId: crypto.randomUUID(),
      model: MODEL,
    }),
  });
  expect(res.status).toBe(202);
  const { conversationId } = (await res.json()) as { conversationId: string };

  const events: string[] = [];
  const off = subscribe(conversationId, (e: StreamEvent) => {
    if (e.type === "questions") events.push(`questions:${e.toolUseIds.length}`);
    if (e.type === "state") events.push(`state:${e.state}`);
  });

  const [toolUseId] = await until(() => {
    const ids = getPendingQuestionIds(conversationId);
    return ids.length ? ids : null;
  }, "the CLI to ask");

  // The question is in the transcript under the same id the CLI asked with —
  // what the renderer joins on. Polled: the row is written by the turn loop,
  // which the ask does not wait for.
  const question = await until(async () => {
    const found = blocksOf(await getConversation(conversationId)).find(
      ({ block }) => block.type === "tool_use" && block.id === toolUseId,
    );
    return found ? found.block : null;
  }, "the tool_use row");

  return { conversationId, toolUseId: toolUseId!, question, events, off };
};

const turnOver = (conversationId: string) =>
  until(async () => {
    const c = await getConversation(conversationId);
    return c.streamStatus === "idle" && c.messages.some((m) => m.sdkMessage.type === "result")
      ? c
      : null;
  }, "the turn to finish");

const teardown = async (conversationId: string) => {
  getHandle(conversationId)?.promptStream.end();
  await until(() => (getHandle(conversationId) === undefined ? true : null), "teardown", 20_000);
};

describe("AskUserQuestion against the real CLI", () => {
  test("bypass mode still asks, and the answer reaches the model", { timeout: TIMEOUT }, async () => {
    const { conversationId, toolUseId, question, events, off } = await askedTurn();
    const parsed = parseAskUserQuestionInput(question.input);
    expect(question.name).toBe("AskUserQuestion");
    expect(parsed).not.toBeNull();
    const q = parsed!.questions[0]!;
    const blue = q.options.find((o) => /blue/i.test(o.label))!;

    const res = await app.request(
      `/api/chat/${conversationId}/question/${toolUseId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: { [q.question]: blue.label } }),
      },
    );
    expect(res.status).toBe(200);

    const done = await turnOver(conversationId);
    off();
    const result = blocksOf(done).find(
      ({ block }) => block.type === "tool_result" && block.tool_use_id === toolUseId,
    )!;
    const finalText = done.messages
      .map((m) => m.sdkMessage)
      .filter((s) => s.type === "result")
      .map((s) => ("result" in s ? String(s.result) : ""))
      .join("");

    expect({
      isError: result.block.is_error ?? false,
      // The structured output the card renders from, keyed by question text.
      toolUseResultAnswers: (result.sdkMessage as { tool_use_result?: { answers?: Record<string, string> } })
        .tool_use_result?.answers?.[q.question],
      modelSaidBlue: /blue/i.test(finalText),
      // Asked once, then cleared — the card came down when the answer went in.
      questionEvents: events.filter((e) => e.startsWith("questions")),
      // The CLI reports requires_action while it waits on us.
      sawRequiresAction: events.includes("state:requires_action"),
    }).toMatchInlineSnapshot(`
      {
        "isError": false,
        "modelSaidBlue": true,
        "questionEvents": [
          "questions:1",
          "questions:0",
        ],
        "sawRequiresAction": true,
        "toolUseResultAnswers": "Blue",
      }
    `);
    await teardown(conversationId);
  });

  test("declining hands the model our message as the tool's error", { timeout: TIMEOUT }, async () => {
    const { conversationId, toolUseId, off } = await askedTurn();

    const res = await app.request(`/api/chat/${conversationId}/question/${toolUseId}`, {
      method: "DELETE",
    });
    expect(await res.json()).toEqual({ declined: true });

    const done = await turnOver(conversationId);
    off();
    const result = blocksOf(done).find(
      ({ block }) => block.type === "tool_result" && block.tool_use_id === toolUseId,
    )!;

    expect({
      isError: result.block.is_error ?? false,
      carriesOurMessage: textOf(result.block.content).includes(
        "The user declined to answer.",
      ),
      stillPending: getPendingQuestionIds(conversationId),
    }).toMatchInlineSnapshot(`
      {
        "carriesOurMessage": true,
        "isError": true,
        "stillPending": [],
      }
    `);
    await teardown(conversationId);
  });

  test("Stop while the CLI waits takes the question down", { timeout: TIMEOUT }, async () => {
    const { conversationId, events, off } = await askedTurn();

    const stop = await app.request(`/api/chat/${conversationId}/stream`, { method: "DELETE" });
    expect(await stop.json()).toEqual({ cancelled: true });

    await until(
      () => (getHandle(conversationId)?.cliState === "idle" ? true : null),
      "the CLI to settle back to idle",
    );
    off();

    expect({
      stillPending: getPendingQuestionIds(conversationId),
      questionEvents: events.filter((e) => e.startsWith("questions")),
    }).toMatchInlineSnapshot(`
      {
        "questionEvents": [
          "questions:1",
          "questions:0",
        ],
        "stillPending": [],
      }
    `);
    await teardown(conversationId);
  });
});

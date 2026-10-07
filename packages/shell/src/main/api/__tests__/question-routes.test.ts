import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "@/main/api";
import type { StreamEvent } from "@/main/api";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import { createConversation } from "@/main/api/services/chat.service";
import { buildPrompt } from "@/main/api/claude-code-ops";
import { createCanUseTool } from "@/main/api/ask-user-question";
import {
  getPendingQuestionIds,
  openHandle,
  releaseHandle,
} from "@/main/lib/conversation-store";

// The routes and the stream seed, against the real app and DB. The CLI's side
// is the real canUseTool callback, called the way the SDK calls it — only the
// process at the other end is missing.
const workspaceId = crypto.randomUUID();
beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
  });
  await db.insert(workspaces).values({ id: workspaceId, name: "question-routes" });
});

const QUESTION = "Which layout should the hero use?";
const input = {
  questions: [
    {
      question: QUESTION,
      header: "Layout",
      multiSelect: false,
      options: [
        { label: "Split hero", description: "Copy left, shot right" },
        { label: "Centered", description: "Headline over an image" },
      ],
    },
  ],
};

// A live conversation with one question parked on it, as the CLI would leave
// it mid-turn. Returns the request the CLI is waiting on.
const askedConversation = async () => {
  const created = await createConversation(workspaceId);
  if (created.isErr()) throw new Error("failed to create conversation");
  const id = created.value.id;
  openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));
  const asked = createCanUseTool(id)("AskUserQuestion", input, {
    signal: new AbortController().signal,
    toolUseID: "toolu_01Hq",
    requestId: "req-1",
  });
  return { id, asked };
};

const post = (id: string, toolUseId: string, body: unknown) =>
  app.request(`/api/chat/${id}/question/${toolUseId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const del = (id: string, toolUseId: string) =>
  app.request(`/api/chat/${id}/question/${toolUseId}`, { method: "DELETE" });

const reply = async (res: Response) => ({ status: res.status, body: await res.json() });

describe("POST /chat/:conversationId/question/:toolUseId", () => {
  test("answers the waiting request with the answers added to its input", async () => {
    const { id, asked } = await askedConversation();

    const res = await post(id, "toolu_01Hq", { answers: { [QUESTION]: "Centered" } });

    expect(await reply(res)).toMatchInlineSnapshot(`
      {
        "body": {
          "answered": true,
        },
        "status": 200,
      }
    `);
    expect(await asked).toMatchInlineSnapshot(`
      {
        "behavior": "allow",
        "updatedInput": {
          "answers": {
            "Which layout should the hero use?": "Centered",
          },
          "questions": [
            {
              "header": "Layout",
              "multiSelect": false,
              "options": [
                {
                  "description": "Copy left, shot right",
                  "label": "Split hero",
                },
                {
                  "description": "Headline over an image",
                  "label": "Centered",
                },
              ],
              "question": "Which layout should the hero use?",
            },
          ],
        },
      }
    `);
    expect(getPendingQuestionIds(id)).toEqual([]);
    releaseHandle(id);
  });

  test("answers that do not fit are a 400, and the question keeps waiting", async () => {
    const { id } = await askedConversation();

    const res = await post(id, "toolu_01Hq", { answers: { "Which font?": "Inter" } });

    expect(await reply(res)).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "UNKNOWN_QUESTION",
            "message": "No question reads "Which font?".",
          },
        },
        "status": 400,
      }
    `);
    expect(getPendingQuestionIds(id)).toEqual(["toolu_01Hq"]);
    releaseHandle(id);
  });

  test("a question nothing is waiting on is a 404", async () => {
    const { id } = await askedConversation();

    const res = await post(id, "toolu_other", { answers: { [QUESTION]: "Centered" } });

    expect(await reply(res)).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "NOT_PENDING",
            "message": "No question is waiting under that id.",
          },
        },
        "status": 404,
      }
    `);
    releaseHandle(id);
  });

  test("a body that is not answers never reaches the store", async () => {
    const { id } = await askedConversation();

    const res = await post(id, "toolu_01Hq", { answers: { [QUESTION]: 3 } });

    expect(res.status).toBe(400);
    expect(getPendingQuestionIds(id)).toEqual(["toolu_01Hq"]);
    releaseHandle(id);
  });
});

describe("DELETE /chat/:conversationId/question/:toolUseId", () => {
  test("declines the waiting request; a second decline finds nothing", async () => {
    const { id, asked } = await askedConversation();

    const first = await reply(await del(id, "toolu_01Hq"));
    const second = await reply(await del(id, "toolu_01Hq"));

    expect({ first, second }).toMatchInlineSnapshot(`
      {
        "first": {
          "body": {
            "declined": true,
          },
          "status": 200,
        },
        "second": {
          "body": {
            "declined": false,
          },
          "status": 404,
        },
      }
    `);
    expect(await asked).toMatchInlineSnapshot(`
      {
        "behavior": "deny",
        "message": "The user declined to answer. Continue without their input, or ask in plain text.",
      }
    `);
    releaseHandle(id);
  });
});

// The first `count` frames of the conversation's stream, then hang up.
const firstFrames = async (id: string, count: number): Promise<StreamEvent[]> => {
  const leave = new AbortController();
  const res = await app.request(`/api/chat/${id}/stream`, { signal: leave.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data:"));
      if (data) events.push(JSON.parse(data.slice(5)));
    }
  }
  leave.abort();
  await reader.cancel().catch(() => {});
  return events.slice(0, count);
};

describe("the stream seed", () => {
  test("a subscriber attaching mid-question is told it is waiting", async () => {
    const { id } = await askedConversation();

    const seeds = await firstFrames(id, 4);

    expect(seeds).toMatchInlineSnapshot(`
      [
        {
          "state": "spawning",
          "type": "state",
        },
        {
          "type": "queue",
          "userMessageIds": [],
        },
        {
          "toolUseIds": [
            "toolu_01Hq",
          ],
          "type": "questions",
        },
        {
          "livePartial": null,
          "type": "livePartial",
        },
      ]
    `);
    releaseHandle(id);
  });
});

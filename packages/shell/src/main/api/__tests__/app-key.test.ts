import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { app } from "@/main/api";
import { APP_KEY } from "@/main/lib/app-key";

// A workspace preview shares the app's session, and its fetch, form posts and
// frame navigations all reach antidraw://app/api: no CORS check stops them,
// and they read the answer. So every route refuses a request without the app
// key, before it runs, whatever it asks for. (Not the Claude Code login
// route: should this check ever break, the test would open Terminal.)
const workspaceId = randomUUID();
const conversationId = randomUUID();
const requests: [method: string, path: string, init?: RequestInit][] = [
  ["POST", "/api/chat/message", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "rm -rf ~", workspaceId, userMessageId: randomUUID() }),
  }],
  // A form post's body: text/plain, no preflight.
  ["POST", "/api/chat/message", { headers: { "content-type": "text/plain" }, body: '{"message":"hi"}' }],
  ["GET", `/api/chat/${conversationId}`],
  ["GET", `/api/chat/${conversationId}/stream`],
  ["DELETE", `/api/chat/${conversationId}/stream`],
  ["GET", "/api/workspaces"],
  ["DELETE", `/api/workspaces/${workspaceId}`],
  ["POST", `/api/workspaces/${workspaceId}/publish`],
  ["GET", `/api/workspaces/${workspaceId}/comments`],
  ["GET", "/api/account"],
  ["GET", "/api/models"],
  ["PUT", "/api/preferences/model", { headers: { "content-type": "application/json" }, body: "{}" }],
  ["GET", "/api/no-such-route"],
];

const statuses = (key?: string) =>
  Promise.all(
    requests.map(async ([method, path, init]) => {
      const headers = { ...(init?.headers as Record<string, string>), ...(key ? { "x-antidraw-app-key": key } : {}) };
      const res = await app.request(path, { ...init, method, headers });
      return `${method} ${path.replaceAll(workspaceId, ":ws").replaceAll(conversationId, ":conv")} → ${res.status}`;
    }),
  );

test("every route refuses a request without the app key", async () => {
  expect(await statuses()).toMatchInlineSnapshot(`
    [
      "POST /api/chat/message → 403",
      "POST /api/chat/message → 403",
      "GET /api/chat/:conv → 403",
      "GET /api/chat/:conv/stream → 403",
      "DELETE /api/chat/:conv/stream → 403",
      "GET /api/workspaces → 403",
      "DELETE /api/workspaces/:ws → 403",
      "POST /api/workspaces/:ws/publish → 403",
      "GET /api/workspaces/:ws/comments → 403",
      "GET /api/account → 403",
      "GET /api/models → 403",
      "PUT /api/preferences/model → 403",
      "GET /api/no-such-route → 403",
    ]
  `);
});

test("and one with another key", async () => {
  expect(new Set((await statuses("x".repeat(APP_KEY.length))).map((s) => s.split(" → ")[1]))).toEqual(new Set(["403"]));
});

test("the app's own key goes through", async () => {
  const res = await app.request("/api/no-such-route", { headers: { "x-antidraw-app-key": APP_KEY } });
  expect(res.status).toBe(404);
});

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
import { getHandle } from "@/main/lib/conversation-store";

const ROOT = process.env.ANTIDRAW_ROOT!;

// A hang here is otherwise a bare vitest timeout that names no step.
const t0 = Date.now();
const step = (what: string) =>
  console.error(`[${String(Date.now() - t0).padStart(6)}ms] ${what}`);
const workspaceId = crypto.randomUUID();
const MODEL = "haiku";

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../db/drizzle", import.meta.url)),
  });
  await db.insert(workspaces).values({ id: workspaceId, name: "queueing-e2e" });
  mkdirSync(path.join(ROOT, "workspaces", workspaceId, "source"), {
    recursive: true,
  });
});

// Consumes the real SSE route the renderer connects to, parsing the same wire
// frames @microsoft/fetch-event-source parses. Every event is kept so the
// assertions can look back at transitions rather than having to catch each one
// as it happens.
const openStream = (conversationId: string) => {
  const seen: StreamEvent[] = [];
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const pump = (async () => {
    const res = await app.request(`/api/chat/${conversationId}/stream`, {
      signal: abort.signal,
    });
    expect(res.status).toBe(200);
    reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (data) seen.push(JSON.parse(data.slice(5).trim()) as StreamEvent);
        }
      }
    } catch {
      // aborted at teardown
    }
  })();

  return {
    seen,
    close: async () => {
      abort.abort();
      await reader?.cancel().catch(() => {});
      // Awaited outright. The route used to park on a promise with no
      // resolver, so the body was not guaranteed to end and this had to race
      // a timeout — which made the test tolerate a hang rather than fail on
      // one. The park now resolves on the abort, so the pump ends.
      await pump;
    },
  };
};

// Generous by design. This talks to the real API, and the CLI retries a
// connection failure up to 10 times with backoff — a run once took 93s to
// produce its first token after three UNKNOWN_CERTIFICATE_VERIFICATION_ERRORs.
// Anything tighter fails on a flaky network rather than on a real defect.
const CLI_TIMEOUT_MS = 200_000;

const until = async <T>(
  probe: () => T | null | Promise<T | null>,
  what: string,
  timeoutMs = CLI_TIMEOUT_MS,
  diagnose?: () => Promise<string>,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) {
      const detail = diagnose ? await diagnose().catch(() => "") : "";
      throw new Error(`Timed out waiting for ${what}${detail}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
};

const post = async (body: Record<string, unknown>) => {
  const res = await app.request("/api/chat/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, model: MODEL, ...body }),
  });
  expect(res.status).toBe(202);
  return (await res.json()) as { conversationId: string };
};

const getConversation = async (id: string) => {
  const res = await app.request(`/api/chat/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ConversationWithMessages;
};

const queueSnapshots = (seen: StreamEvent[]) =>
  seen.flatMap((e) => (e.type === "queue" ? [e.userMessageIds] : []));

// A timed-out e2e is usually the network, not the code. Say so in the failure
// rather than leaving the next person to go digging through ~/.claude.
const diagnoseFrom = (conversationId: string) => async () => {
  const { messages } = await getConversation(conversationId);
  const kinds = messages.map((m) => {
    const sdk = m.sdkMessage as { type: string; subtype?: string };
    return sdk.subtype ? `${sdk.type}/${sdk.subtype}` : sdk.type;
  });
  const apiErrors = kinds.filter((k) => k.includes("api_error")).length;
  return (
    `\n  persisted so far: ${kinds.join(", ") || "(none)"}` +
    (apiErrors
      ? `\n  ${apiErrors} api_error(s) — the CLI could not reach the API; ` +
        `this is an environment failure, not a defect.`
      : "")
  );
};

describe("a message sent mid-turn", () => {
  test(
    "is queued, acked by the CLI, and runs as its own turn",
    { timeout: 600_000 },
    async () => {
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();

      // Long enough to still be streaming when the second message lands.
      const { conversationId } = await post({
        message:
          "Count from 1 to 40, one number per line. Output only the numbers.",
        userMessageId: firstId,
      });

      const stream = openStream(conversationId);

      // The seed frame, before anything live.
      await until(
        () => (stream.seen.some((e) => e.type === "queue") ? true : null),
        "the queue seed",
        20_000,
      );
      step("subscribed, seed received");

      // Wait until the CLI itself reports it is working, so the second
      // message is genuinely sent into a live turn rather than before one.
      await until(
        () =>
          stream.seen.some((e) => e.type === "state" && e.state === "running")
            ? true
            : null,
        "the CLI to start the first turn",
        CLI_TIMEOUT_MS,
        diagnoseFrom(conversationId),
      );
      step("first turn running");

      // Identity of the live handle, captured before the second send. Without
      // this the test is vacuous: had the first turn already finished, the
      // second message would cold-start a NEW handle and still produce a queue
      // snapshot, an ack, two results and "SECOND" — passing while proving
      // nothing about queueing. Same object after the send == pushed into the
      // CLI that was already running.
      const liveHandle = getHandle(conversationId);
      expect(liveHandle).toBeDefined();
      expect(liveHandle!.cliState).toBe("running");
      const firstTurnDone = (await getConversation(conversationId)).messages.some(
        (m) => m.sdkMessage.type === "result",
      );
      expect(firstTurnDone).toBe(false);

      await post({
        message: "Reply with exactly: SECOND",
        userMessageId: secondId,
        conversationId,
      });

      expect(getHandle(conversationId)).toBe(liveHandle);

      // QUEUED: the backend has taken it but the CLI has not acked it.
      const queuedSnapshot = await until(
        () =>
          queueSnapshots(stream.seen).find((ids) => ids.includes(secondId)) ??
          null,
        "the second message to appear queued",
        30_000,
      );
      expect(queuedSnapshot).toContain(secondId);
      step("second message observed queued");

      // ACKED: --replay-user-messages echoed it back, so it left the queue.
      await until(
        () => {
          const snapshots = queueSnapshots(stream.seen);
          const queuedAt = snapshots.findIndex((ids) => ids.includes(secondId));
          return snapshots
            .slice(queuedAt + 1)
            .some((ids) => !ids.includes(secondId))
            ? true
            : null;
        },
        "the CLI to ack the second message",
        CLI_TIMEOUT_MS,
        diagnoseFrom(conversationId),
      );
      step("second message acked by the CLI");

      // Both turns finished: the CLI reports idle only once its own command
      // queue has drained, which is why `result` is not the end-of-turn signal.
      const conversation = await until(async () => {
        const c = await getConversation(conversationId);
        const results = c.messages.filter((m) => m.sdkMessage.type === "result");
        return c.streamStatus === "idle" && results.length >= 2 ? c : null;
      }, "both turns to complete", CLI_TIMEOUT_MS, diagnoseFrom(conversationId));
      step("both turns complete");

      // Both prompts persisted, under the ids the frontend chose, in order.
      const prompts = conversation.messages.filter(
        (m) => m.messageType === "user_prompt",
      );
      expect(prompts.map((p) => p.id)).toEqual([firstId, secondId]);

      // Two turns, not one: the queued message ran on its own.
      const results = conversation.messages.filter(
        (m) => m.sdkMessage.type === "result",
      );
      expect(results).toHaveLength(2);

      // The second message was actually answered.
      const assistants = conversation.messages.filter(
        (m) => m.sdkMessage.type === "assistant",
      );
      expect(JSON.stringify(assistants.map((a) => a.sdkMessage))).toContain(
        "SECOND",
      );

      // seq orders the transcript, and the prompt precedes its own reply.
      expect(conversation.messages.map((m) => m.seq)).toEqual(
        [...conversation.messages.map((m) => m.seq)].sort((a, b) => a - b),
      );
      const secondPromptSeq = prompts[1]!.seq;
      expect(
        assistants.some(
          (a) =>
            a.seq > secondPromptSeq &&
            JSON.stringify(a.sdkMessage).includes("SECOND"),
        ),
      ).toBe(true);

      // The queue drains: nothing is left marked as pending.
      const finalSnapshot = queueSnapshots(stream.seen).at(-1);
      expect(finalSnapshot).toEqual([]);

      step("assertions done");
      await stream.close();
      step("stream closed");

      getHandle(conversationId)?.promptStream.end();
      await until(
        () => (getHandle(conversationId) === undefined ? true : null),
        "stream teardown",
        20_000,
      );
      step("teardown complete");
    },
  );
});

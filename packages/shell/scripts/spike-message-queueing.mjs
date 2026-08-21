// Spike: how does the Claude Agent SDK / CLI behave when user messages are
// pushed into a live streaming-input query while a turn is in flight?
//
// Questions this answers (see summary printed at the end of each scenario):
//   1. Is a mid-turn push queued, merged into the current turn, or rejected?
//   2. When does the CLI "accept" it — is there an ack we can correlate by uuid?
//      (--replay-user-messages re-emits user messages with isReplay: true)
//   3. Does one pushed message == one turn (one `result`), or do queued
//      messages get batched into a single turn?
//   4. What does priority: "now" do (interrupt?) vs the default "next"?
//   5. Can a queued message be withdrawn with cancelAsyncMessage(uuid)?
//   6. What does shouldQuery: false do?
//
// Run:  node packages/shell/scripts/spike-message-queueing.mjs [scenario...]
// Scenarios: queue | later | next | idleLater | now | interrupt | cancel | shouldQuery | noreplay   (default: all)
// Uses the locally authed Claude Code session (no API key needed).

import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MODEL = process.env.SPIKE_MODEL ?? "haiku";
const cwd = mkdtempSync(path.join(tmpdir(), "antidraw-queue-spike-"));

// ---------------------------------------------------------------------------
// Prompt stream: same shape as packages/shell/src/main/api/claude-code-ops.ts
// buildPrompt() — a ReadableStream we can enqueue into at any time.
// ---------------------------------------------------------------------------
const buildPrompt = () => {
  let controller;
  const prompt = new ReadableStream({ start: (c) => (controller = c) });
  let closed = false;
  return {
    prompt,
    push: (text, extra = {}) => {
      const uuid = extra.uuid ?? randomUUID();
      const msg = {
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
        parent_tool_use_id: null,
        uuid,
        ...extra,
      };
      if (!closed) controller.enqueue(msg);
      return uuid;
    },
    end: () => {
      if (closed) return;
      closed = true;
      controller.close();
    },
  };
};

const t0 = Date.now();
const ts = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const short = (u) => (u ? String(u).slice(0, 8) : "--------");
const log = (...a) => console.log(ts(), ...a);

const LONG_TURN =
  "Use the Bash tool to run exactly `sleep 6` (nothing else), then reply with exactly: done A";

// ---------------------------------------------------------------------------
// Runs one scenario: spawns a fresh query, drives it with `plan`, records a
// timeline, prints a summary. `plan` receives helpers and returns a promise
// that resolves when the scenario is done (we then end the input stream).
// ---------------------------------------------------------------------------
async function runScenario(name, { replay = true, plan }) {
  console.log(`\n${"=".repeat(78)}\n SCENARIO: ${name}\n${"=".repeat(78)}`);
  const ps = buildPrompt();
  const abortController = new AbortController();
  const timeline = []; // {t, kind, uuid, note}
  const labels = new Map(); // uuid -> label
  const pushed = new Map(); // uuid -> {label, pushedAt, ackAt?, turn?}
  let turn = 0; // number of `result` messages seen so far
  let streamEventsThisTurn = 0;
  let firstStreamEventResolve;
  const firstStreamEvent = new Promise((r) => (firstStreamEventResolve = r));
  const resultWaiters = [];
  const waitForResults = (n) =>
    new Promise((resolve) => {
      if (turn >= n) return resolve();
      resultWaiters.push({ n, resolve });
    });
  // Resolves once at least `minResults` results have arrived AND the CLI has
  // been quiet (no non-partial message) for `quietMs`. Lets us see whether
  // queued messages spawn follow-on turns without guessing a count.
  let lastActivity = Date.now();
  const waitForIdle = async (minResults, quietMs = 6000, maxMs = 60000) => {
    const start = Date.now();
    for (;;) {
      await sleep(250);
      if (turn >= minResults && Date.now() - lastActivity > quietMs) return;
      if (Date.now() - start > maxMs) return;
    }
  };

  const push = (label, text, extra) => {
    const uuid = ps.push(text, extra);
    labels.set(uuid, label);
    pushed.set(uuid, { label, pushedAt: Date.now() - t0 });
    log(`>> push ${label} uuid=${short(uuid)}${extra ? " " + JSON.stringify(extra) : ""}`);
    return uuid;
  };

  const q = query({
    prompt: ps.prompt,
    options: {
      cwd,
      model: MODEL,
      permissionMode: "bypassPermissions",
      persistSession: false,
      includePartialMessages: true,
      abortController,
      ...(replay ? { extraArgs: { "replay-user-messages": null } } : {}),
    },
  });

  const planDone = plan({ push, q, firstStreamEvent, waitForResults, waitForIdle, ps });
  const hardTimeout = setTimeout(() => {
    log("!! hard timeout — aborting");
    abortController.abort();
  }, 90_000);

  try {
    for await (const m of q) {
      if (m.type !== "rate_limit_event") lastActivity = Date.now();
      if (m.type === "stream_event") {
        if (streamEventsThisTurn++ === 0) {
          log(`<< stream_event (first of turn ${turn + 1})`);
          firstStreamEventResolve();
        }
        continue;
      }
      if (m.type === "system" && m.subtype === "init") {
        log(`<< system/init session=${short(m.session_id)}`);
        continue;
      }
      if (m.type === "user") {
        const isReplay = m.isReplay === true;
        const label = labels.get(m.uuid);
        const hasToolResult =
          Array.isArray(m.message?.content) &&
          m.message.content.some((b) => b.type === "tool_result");
        log(
          `<< user ${isReplay ? "REPLAY-ACK" : "     "} uuid=${short(m.uuid)}` +
            `${label ? ` (${label})` : ""}${hasToolResult ? " [tool_result]" : ""}` +
            `${m.isSynthetic ? " [synthetic]" : ""}`,
        );
        if (isReplay && label && pushed.has(m.uuid)) {
          const p = pushed.get(m.uuid);
          p.ackAt = Date.now() - t0;
          p.ackedDuringTurn = turn + 1;
        }
        continue;
      }
      if (m.type === "assistant") {
        const text = (m.message.content ?? [])
          .map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `[tool_use ${b.name}]` : `[${b.type}]`))
          .join(" ")
          .replace(/\s+/g, " ")
          .slice(0, 80);
        log(`<< assistant: ${text}`);
        continue;
      }
      if (m.type === "result") {
        turn++;
        streamEventsThisTurn = 0;
        log(
          `<< RESULT #${turn} subtype=${m.subtype} num_turns=${m.num_turns} ` +
            `result="${String(m.result ?? "").replace(/\s+/g, " ").slice(0, 60)}"`,
        );
        for (const w of resultWaiters.splice(0)) {
          if (turn >= w.n) w.resolve();
          else resultWaiters.push(w);
        }
        continue;
      }
      log(`<< ${m.type}${m.subtype ? "/" + m.subtype : ""}`);
    }
  } catch (e) {
    log("!! loop error:", e?.message ?? e);
  } finally {
    clearTimeout(hardTimeout);
  }
  await planDone.catch((e) => log("!! plan error:", e?.message ?? e));

  console.log(`\n--- summary: ${name} ---`);
  console.log(`turns (result messages): ${turn}`);
  for (const [uuid, p] of pushed) {
    console.log(
      `  ${p.label.padEnd(10)} uuid=${short(uuid)} pushed=+${p.pushedAt}ms  ` +
        (p.ackAt !== undefined
          ? `replay-ack=+${p.ackAt}ms (+${p.ackAt - p.pushedAt}ms later, during turn ${p.ackedDuringTurn})`
          : `replay-ack=NEVER`) +
        (p.note ? `  ${p.note}` : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const scenarios = {
  // Push B and C while A's turn is in flight. Default priority.
  queue: () =>
    runScenario("queue: push B, C mid-turn (default priority)", {
      plan: async ({ push, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        push("B", "Reply with exactly: done B");
        await sleep(500);
        push("C", "Reply with exactly: done C");
        // Wait until every pushed message has produced a result (or the CLI
        // batched them). Give it up to 3 results, but stop early if idle.
        await waitForIdle(1);
        await sleep(1000);
        ps.end();
      },
    }),

  // Same, but explicit priority "later": does it wait for the turn to end?
  later: () =>
    runScenario('later: push B, C mid-turn with priority "later"', {
      plan: async ({ push, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        push("B-later", "Reply with exactly: done B", { priority: "later" });
        await sleep(500);
        push("C-later", "Reply with exactly: done C", { priority: "later" });
        await waitForIdle(1);
        ps.end();
      },
    }),

  // Explicit priority "next" for comparison with the default.
  next: () =>
    runScenario('next: push B mid-turn with priority "next"', {
      plan: async ({ push, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        push("B-next", "Reply with exactly: done B", { priority: "next" });
        await waitForIdle(1);
        ps.end();
      },
    }),

  // "later" while IDLE: does it start immediately, or stall waiting for a
  // turn to end? (Every follow-up push in the app would carry "later".)
  idleLater: () =>
    runScenario('idleLater: priority "later" pushed while idle / right after result', {
      plan: async ({ push, waitForResults, waitForIdle, ps }) => {
        push("A", "Reply with exactly: done A");
        await waitForResults(1);
        // Immediately after the result (the PR #70 race window)
        push("B-later", "Reply with exactly: done B", { priority: "later" });
        await waitForResults(2);
        await sleep(4000); // fully idle now
        push("C-later", "Reply with exactly: done C", { priority: "later" });
        await waitForIdle(3);
        ps.end();
      },
    }),

  // Queue B mid-turn, then interrupt() the turn (the app's Stop button).
  // Does the queued B survive the interrupt and run (and get acked), or is
  // it dropped with it?
  interrupt: () =>
    runScenario("interrupt: push B mid-turn, then query.interrupt()", {
      plan: async ({ push, q, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        push("B", "Reply with exactly: done B");
        await sleep(500);
        log(">> interrupt()");
        await q.interrupt();
        log("<< interrupt() resolved");
        await waitForIdle(1);
        ps.end();
      },
    }),

  // Push B with priority "now" while A is sleeping. Does it interrupt A?
  now: () =>
    runScenario('now: push B with priority "now" mid-turn', {
      plan: async ({ push, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        push("B-now", "Reply with exactly: done B", { priority: "now" });
        await waitForIdle(1);
        await sleep(1000);
        ps.end();
      },
    }),

  // Push B mid-turn, then withdraw it via the (undocumented on the Query
  // type, but present at runtime) cancelAsyncMessage control request.
  cancel: () =>
    runScenario("cancel: push B mid-turn then cancelAsyncMessage(B)", {
      plan: async ({ push, q, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        const b = push("B", "Reply with exactly: done B");
        await sleep(500);
        try {
          const cancelled = await q.cancelAsyncMessage(b);
          log(`<< cancelAsyncMessage(B) -> cancelled=${cancelled}`);
        } catch (e) {
          log(`!! cancelAsyncMessage threw: ${e?.message ?? e}`);
        }
        // Then cancel something that was never queued:
        try {
          const cancelled = await q.cancelAsyncMessage(randomUUID());
          log(`<< cancelAsyncMessage(unknown) -> cancelled=${cancelled}`);
        } catch (e) {
          log(`!! cancelAsyncMessage(unknown) threw: ${e?.message ?? e}`);
        }
        push("C", "Reply with exactly: done C");
        await waitForIdle(1);
        await sleep(1000);
        ps.end();
      },
    }),

  // shouldQuery:false — appended to transcript without starting a turn.
  shouldQuery: () =>
    runScenario("shouldQuery:false then a normal message", {
      plan: async ({ push, waitForIdle, ps }) => {
        push("note", "My favourite colour is teal. (context only)", {
          shouldQuery: false,
        });
        await sleep(3000);
        push("Q", "What is my favourite colour? Reply with one word.");
        await waitForIdle(1);
        await sleep(1000);
        ps.end();
      },
    }),

  // Same as `queue` but WITHOUT --replay-user-messages: is there any ack?
  noreplay: () =>
    runScenario("noreplay: queue scenario without --replay-user-messages", {
      replay: false,
      plan: async ({ push, firstStreamEvent, waitForIdle, ps }) => {
        push("A", LONG_TURN);
        await firstStreamEvent;
        await sleep(1500);
        push("B", "Reply with exactly: done B");
        await waitForIdle(1);
        await sleep(1000);
        ps.end();
      },
    }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(scenarios);
for (const n of names) {
  if (!scenarios[n]) {
    console.error(`unknown scenario "${n}". known: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  }
  await scenarios[n]();
}
log("all done");

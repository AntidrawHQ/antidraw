#!/usr/bin/env node
/**
 * How fast does a dead CLI process propagate to the SDK message iterator?
 *
 * Decides whether index.ts:457-459 needs its explicit drop, or whether the
 * loop's own finally cleans up fast enough on its own.
 *
 *   FAST  → the entry self-cleans; the unregisterStream there is removable
 *   SLOW  → the entry lingers; sends push() into a dead stream and vanish
 *
 * Two kills are tested, because they are NOT the same failure:
 *   A) SIGKILL  — abrupt death. stdio pipes close, so the SDK should see EOF.
 *   B) SIGSTOP  — process alive but frozen. Pipes stay open, nothing arrives.
 *                 This is the "hung/wedged CLI" case, and the one that can
 *                 hang forever with no EOF to detect.
 *
 * Also measures whether push() after death reports anything (it should not —
 * it enqueues into a ReadableStream with no consumer and returns silently).
 *
 * Costs real tokens: one short turn per scenario.
 *
 *   node verify-deadproc.mjs [--repo /path] [--wait 60]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : dflt;
};

const REPO = arg("--repo", process.cwd());
const MAX_WAIT_S = Number(arg("--wait", "60"));
const SDK_ENTRY = path.join(REPO, "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs");

const requireFromRepo = createRequire(path.join(REPO, "package.json"));
let CLI_PATH;
try {
  CLI_PATH = requireFromRepo.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
  );
} catch { /* SDK self-resolves */ }

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

const sleep = (n) => new Promise((r) => setTimeout(r, n));
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, ...a);

const cliPids = () => {
  try {
    return new Set(
      execFileSync("/usr/bin/pgrep", ["-f", "claude-agent-sdk-.*/claude"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim().split("\n").filter(Boolean),
    );
  } catch { return new Set(); }
};
const aliveP = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
const diff = (a, b) => [...b].filter((p) => !a.has(p));

const buildPrompt = (first) => {
  let closed = false, controller;
  const prompt = new ReadableStream({ start: (c) => (controller = c) });
  const push = (text) => {
    if (closed) return "no-op (stream already closed)";
    controller.enqueue({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      uuid: randomUUID(), parent_tool_use_id: null,
    });
    return "enqueued (no error)";
  };
  push(first);
  return { prompt, push, end: () => { if (!closed) { closed = true; controller.close(); } } };
};

/** Run one scenario. signal: "SIGKILL" | "SIGSTOP" */
const scenario = async (query, signal) => {
  console.log(C.b(`\n  ── ${signal} ────────────────────────────────────────────\n`));
  const cwd = mkdtempSync(path.join(tmpdir(), `deadproc-${signal}-`));
  const before = cliPids();
  const ps = buildPrompt("Count from 1 to 300, one number per line. Nothing else.");

  const q = query({
    prompt: ps.prompt,
    options: {
      cwd,
      ...(CLI_PATH ? { pathToClaudeCodeExecutable: CLI_PATH } : {}),
      includePartialMessages: true,
    },
  });

  const st = { firstOutput: false, done: false, err: null, doneAt: null, killAt: null, msgsAfterKill: 0 };
  let killed = false;

  const consume = (async () => {
    try {
      for await (const m of q) {
        if (m.type === "stream_event" && (m.event?.delta?.text || m.event?.delta?.partial_json)) {
          st.firstOutput = true;
        }
        if (killed) st.msgsAfterKill++;
      }
      st.done = true; st.doneAt = Date.now();
    } catch (e) {
      st.err = e; st.done = true; st.doneAt = Date.now();
    }
  })();

  const waitStart = Date.now();
  while (!st.firstOutput && Date.now() - waitStart < 60_000 && !st.done) await sleep(100);
  if (!st.firstOutput) {
    console.log(C.r("  no output — auth problem? aborting scenario"));
    ps.end(); return { signal, inconclusive: true };
  }

  const pid = diff(before, cliPids())[0];
  if (!pid) {
    console.log(C.r("  could not identify spawned pid"));
    ps.end(); return { signal, inconclusive: true };
  }
  log(C.g(`streaming · pid ${pid}`));
  await sleep(1500);

  log(C.b(`sending ${signal} to ${pid}…`));
  killed = true;
  st.killAt = Date.now();
  try { process.kill(Number(pid), signal); } catch (e) { console.log(C.r(`  kill failed: ${e.message}`)); }

  // does push() complain once the process is gone?
  await sleep(500);
  const pushResult = ps.push("are you still there?");

  const deadline = Date.now() + MAX_WAIT_S * 1000;
  let lastTick = 0;
  while (!st.done && Date.now() < deadline) {
    const el = Math.floor((Date.now() - st.killAt) / 1000);
    if (el >= lastTick + 5) { lastTick = el; log(C.d(`  …${el}s, iterator still open`)); }
    await sleep(200);
  }

  // Snapshot BEFORE cleanup — the SIGCONT/SIGKILL below would otherwise end
  // the iterator ourselves and be misread as the SDK having detected it.
  const elapsed = st.done ? st.doneAt - st.killAt : null;
  const detected = st.done;

  if (st.done) {
    log(
      C.g(`iterator ended ${(elapsed / 1000).toFixed(2)}s after ${signal}`) +
      C.d(st.err ? `  (threw: ${String(st.err.message).slice(0, 60)})` : "  (clean completion)"),
    );
  } else {
    log(C.r(`iterator STILL OPEN after ${MAX_WAIT_S}s`));
  }
  log(C.d(`  push() after death → ${pushResult}`));

  // cleanup: unfreeze so we can actually kill it
  if (signal === "SIGSTOP") { try { process.kill(Number(pid), "SIGCONT"); } catch {} }
  try { process.kill(Number(pid), "SIGKILL"); } catch {}
  ps.end();
  await Promise.race([consume, sleep(3000)]);

  return { signal, elapsed, detected, threw: !!st.err, pushResult, msgsAfterKill: st.msgsAfterKill };
};

const main = async () => {
  console.log(C.b("\n  Dead-process detection latency — SDK message iterator\n"));
  log(C.d(`sdk  ${SDK_ENTRY}`));
  log(C.d(`cli  ${CLI_PATH ?? "(self-resolved)"}`));
  log(C.d(`max wait per scenario: ${MAX_WAIT_S}s`));

  const { query } = await import(SDK_ENTRY);
  const out = [];
  out.push(await scenario(query, "SIGKILL"));
  out.push(await scenario(query, "SIGSTOP"));

  console.log(C.b("\n  ── Verdict ─────────────────────────────────────────────\n"));
  for (const r of out) {
    if (r.inconclusive) { console.log(`  ${r.signal.padEnd(8)} ${C.y("INCONCLUSIVE")}`); continue; }
    const s = r.detected
      ? `${(r.elapsed / 1000).toFixed(2)}s  ${r.threw ? "(iterator threw)" : "(clean end)"}`
      : C.r(`never (>${MAX_WAIT_S}s)`);
    console.log(`  ${r.signal.padEnd(8)} → ${s}`);
  }

  const kill = out.find((r) => r.signal === "SIGKILL");
  const stop = out.find((r) => r.signal === "SIGSTOP");
  console.log("");

  if (kill?.detected && kill.elapsed < 3000) {
    console.log(
      "  " + C.g("ABRUPT DEATH: self-cleans") +
      `\n  The iterator ends ${(kill.elapsed / 1000).toFixed(2)}s after the process dies, so the loop\n` +
      "  exits and its finally unregisters. The explicit drop at index.ts:459\n" +
      "  is not needed for this case.\n",
    );
  } else if (kill?.detected) {
    console.log(
      "  " + C.y("ABRUPT DEATH: slow") +
      `\n  ${(kill.elapsed / 1000).toFixed(2)}s is long enough for a send to land on a dead entry\n` +
      "  and be swallowed by push(). The drop is buying real protection.\n",
    );
  } else {
    console.log("  " + C.r("ABRUPT DEATH: never detected") + " — the entry would leak. Keep the drop.\n");
  }

  if (stop && !stop.detected) {
    console.log(
      "  " + C.y("FROZEN PROCESS: never detected") +
      `\n  A wedged CLI keeps its pipes open, so there is no EOF and the iterator\n` +
      "  waits forever. Nothing self-cleans here — but note a frozen process\n" +
      "  also can't answer a control request, so this is exactly the case where\n" +
      "  setModel() times out. Removing the drop leaves this entry stranded.\n",
    );
  } else if (stop?.detected) {
    console.log(
      "  " + C.g("FROZEN PROCESS: detected") +
      ` after ${(stop.elapsed / 1000).toFixed(2)}s — the SDK has its own timeout.\n`,
    );
  }

  const stray = cliPids();
  if (stray.size) console.log(C.y(`  ⚠ CLI processes still running: ${[...stray].join(", ")}\n`));
  process.exit(0);
};

setTimeout(() => { console.log(C.r("\n  hard timeout\n")); process.exit(3); }, 300_000).unref();
main().catch((e) => { console.error(C.r("\n  harness error:"), e); process.exit(1); });

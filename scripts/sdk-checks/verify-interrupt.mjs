#!/usr/bin/env node
/**
 * Independent verification of claude-agent-sdk interrupt() semantics.
 *
 * Does NOT import any antidraw code — it talks to the SDK directly, so the
 * result is evidence about the SDK/CLI, not about our wrapper.
 *
 * Claims under test:
 *   C1  interrupt() aborts the in-flight turn
 *   C2  the CLI process SURVIVES interrupt
 *   C3  the message iterator does NOT terminate after interrupt
 *   C4  the session stays usable — a turn pushed after interrupt gets answered
 *   C5  closing the input stream (end()) is what ends the iterator + process
 *
 * C2 + C3 together are the leak precondition: if both hold, cancelStream()
 * deleting the map entry strands a live process behind a suspended loop.
 *
 * Costs real tokens: two short turns against the API.
 *
 *   node verify-interrupt.mjs [--repo /path/to/antidraw]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------- config

const argRepo = process.argv.indexOf("--repo");
const REPO =
  argRepo !== -1 ? process.argv[argRepo + 1] : process.cwd();

const SDK_ENTRY = path.join(
  REPO,
  "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
);

// Same resolution the app uses (claude-code-ops.ts), minus the asar rewrite.
const requireFromRepo = createRequire(path.join(REPO, "package.json"));
let CLI_PATH;
try {
  CLI_PATH = requireFromRepo.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
  );
} catch {
  CLI_PATH = undefined; // let the SDK self-resolve
}

const LONG_PROMPT =
  "Count from 1 to 300. One number per line. Output nothing else at all.";
const SECOND_PROMPT = "Reply with exactly the word READY and nothing else.";

const INTERRUPT_AFTER_MS = 2500; // let the first turn genuinely start
const SETTLE_MS = 4000; // how long we watch for the iterator to (not) end
const HARD_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------- utils

const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6);
const log = (...a) => console.log(`[${ms()}ms]`, ...a);
const sleep = (n) => new Promise((r) => setTimeout(r, n));

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** PIDs of running CLI processes spawned from the SDK's native binary. */
const cliPids = () => {
  try {
    const out = execFileSync("/usr/bin/pgrep", ["-f", "claude-agent-sdk-.*/claude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(out.trim().split("\n").filter(Boolean));
  } catch {
    return new Set(); // pgrep exits 1 when nothing matches
  }
};

const alive = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const diff = (before, after) => [...after].filter((p) => !before.has(p));

/** Mirrors buildPrompt() in claude-code-ops.ts — a pushable input stream. */
const buildPrompt = (first) => {
  let closed = false;
  let controller;
  const prompt = new ReadableStream({ start: (c) => (controller = c) });
  const push = (text) => {
    if (closed) return;
    controller.enqueue({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      uuid: randomUUID(),
      parent_tool_use_id: null,
    });
  };
  push(first);
  return {
    prompt,
    push,
    end: () => {
      if (closed) return;
      closed = true;
      controller.close();
    },
  };
};

// ---------------------------------------------------------------- run

const results = {};
const record = (id, pass, detail) => {
  results[id] = { pass, detail };
  const mark = pass === true ? C.g("PASS") : pass === false ? C.r("FAIL") : C.y("INCONCLUSIVE");
  log(`  ${mark}  ${id}  ${detail}`);
};

const main = async () => {
  console.log(C.b("\n  SDK interrupt() semantics — independent verification\n"));
  log(C.d(`repo      ${REPO}`));
  log(C.d(`sdk       ${SDK_ENTRY}`));
  log(C.d(`cli       ${CLI_PATH ?? "(self-resolved by SDK)"}`));

  const { query } = await import(SDK_ENTRY);
  const cwd = mkdtempSync(path.join(tmpdir(), "verify-interrupt-"));
  log(C.d(`cwd       ${cwd}\n`));

  const pidsBefore = cliPids();
  log(`CLI processes before spawn: ${pidsBefore.size}`);

  const ps = buildPrompt(LONG_PROMPT);
  const q = query({
    prompt: ps.prompt,
    options: {
      cwd,
      ...(CLI_PATH ? { pathToClaudeCodeExecutable: CLI_PATH } : {}),
      includePartialMessages: true,
    },
  });

  // ---- observation state -------------------------------------------------
  const state = {
    iteratorDone: false,
    iteratorError: null,
    firstOutputAt: null,
    interruptAt: null,
    resultsAfterInterrupt: 0,
    outputCharsAfterInterrupt: 0,
    secondTurnReply: null,
    sawSecondTurnResult: false,
    endCalledAt: null,
    doneAt: null,
    ourPid: null,
  };

  let phase = "turn1";

  const consume = (async () => {
    try {
      for await (const m of q) {
        if (m.type === "stream_event") {
          const d = m.event?.delta;
          const text = d?.text ?? d?.partial_json ?? "";
          if (text) {
            state.firstOutputAt ??= Date.now();
            if (phase === "post-interrupt") state.outputCharsAfterInterrupt += text.length;
            if (phase === "turn2" && state.secondTurnReply === null) state.secondTurnReply = "";
            if (phase === "turn2") state.secondTurnReply += text;
          }
          continue;
        }
        if (m.type === "system" && m.subtype === "init") {
          log(C.d(`  init · session ${m.session_id?.slice(0, 8)}…`));
          continue;
        }
        if (m.type === "assistant") {
          state.firstOutputAt ??= Date.now();
          continue;
        }
        if (m.type === "result") {
          log(C.d(`  result · subtype=${m.subtype} phase=${phase}`));
          if (phase === "post-interrupt") state.resultsAfterInterrupt++;
          if (phase === "turn2") state.sawSecondTurnResult = true;
        }
      }
      state.iteratorDone = true;
      state.doneAt = Date.now();
    } catch (e) {
      state.iteratorError = e;
      state.iteratorDone = true;
      state.doneAt = Date.now();
    }
  })();

  // ---- wait for the turn to be genuinely underway ------------------------
  const startedWaiting = Date.now();
  while (!state.firstOutputAt && Date.now() - startedWaiting < 60_000 && !state.iteratorDone) {
    await sleep(100);
  }
  if (!state.firstOutputAt) {
    console.log(C.r("\n  No output from the first turn — cannot proceed."));
    console.log(C.d("  Likely auth. Try `claude` in a terminal first.\n"));
    ps.end();
    process.exit(2);
  }
  log(C.g("turn 1 producing output"));

  const pidsAfterSpawn = cliPids();
  const ourPids = diff(pidsBefore, pidsAfterSpawn);
  state.ourPid = ourPids[0];
  log(`spawned CLI pid(s): ${ourPids.join(", ") || "(none detected)"}`);

  await sleep(INTERRUPT_AFTER_MS);

  // ---- INTERRUPT ---------------------------------------------------------
  const charsBefore = state.outputCharsAfterInterrupt;
  phase = "post-interrupt";
  state.interruptAt = Date.now();
  log(C.b("calling interrupt()…"));
  let interruptErr = null;
  try {
    await q.interrupt();
    log(C.g("interrupt() resolved") + C.d("  (a dead process could not have replied)"));
  } catch (e) {
    interruptErr = e;
    log(C.r(`interrupt() threw: ${e.message}`));
  }

  await sleep(SETTLE_MS);

  // ---- C1 · did the turn actually stop? ----------------------------------
  const growthWindow = state.outputCharsAfterInterrupt;
  await sleep(1500);
  const stillGrowing = state.outputCharsAfterInterrupt > growthWindow;
  record(
    "C1",
    !stillGrowing && !interruptErr,
    stillGrowing
      ? "output still streaming 5.5s after interrupt — turn NOT aborted"
      : `turn stopped (${state.outputCharsAfterInterrupt - charsBefore} chars after interrupt, then quiet)`,
  );

  // ---- C2 · did the process survive? -------------------------------------
  const pidAliveNow = state.ourPid ? alive(state.ourPid) : null;
  record(
    "C2",
    state.ourPid ? pidAliveNow : null,
    state.ourPid
      ? pidAliveNow
        ? `pid ${state.ourPid} STILL RUNNING after interrupt`
        : `pid ${state.ourPid} exited after interrupt`
      : "could not identify the spawned pid (pgrep found nothing)",
  );

  // ---- C3 · did the iterator terminate? ----------------------------------
  record(
    "C3",
    !state.iteratorDone,
    state.iteratorDone
      ? "iterator TERMINATED after interrupt — loop would exit, finally would run"
      : `iterator still open ${Math.round((Date.now() - state.interruptAt) / 1000)}s after interrupt (saw ${state.resultsAfterInterrupt} result msg)`,
  );

  // ---- C4 · is the session still usable? ---------------------------------
  if (state.iteratorDone) {
    record("C4", null, "skipped — iterator already closed");
  } else {
    phase = "turn2";
    log(C.b("pushing a second turn into the same stream…"));
    ps.push(SECOND_PROMPT);
    const waitStart = Date.now();
    while (!state.sawSecondTurnResult && Date.now() - waitStart < 90_000 && !state.iteratorDone) {
      await sleep(200);
    }
    const reply = (state.secondTurnReply ?? "").trim();
    record(
      "C4",
      state.sawSecondTurnResult && /READY/i.test(reply),
      state.sawSecondTurnResult
        ? `second turn answered: ${JSON.stringify(reply.slice(0, 60))}`
        : "second turn never produced a result — session unusable after interrupt",
    );
  }

  // ---- C5 · does end() close it down? ------------------------------------
  log(C.b("calling promptStream.end()…"));
  state.endCalledAt = Date.now();
  ps.end();
  const endWait = Date.now();
  while (!state.iteratorDone && Date.now() - endWait < 30_000) await sleep(200);

  const closedAfterEnd = state.iteratorDone;
  let pidGoneAfterEnd = null;
  if (state.ourPid) {
    for (let i = 0; i < 30 && alive(state.ourPid); i++) await sleep(200);
    pidGoneAfterEnd = !alive(state.ourPid);
  }
  record(
    "C5",
    closedAfterEnd && (pidGoneAfterEnd ?? true),
    closedAfterEnd
      ? `iterator closed ${Math.round((state.doneAt - state.endCalledAt) / 1000)}s after end(); process ${pidGoneAfterEnd === null ? "unknown" : pidGoneAfterEnd ? "exited" : C.r("STILL ALIVE")}`
      : "iterator did NOT close within 30s of end()",
  );

  await Promise.race([consume, sleep(5000)]);

  // ---- verdict -----------------------------------------------------------
  console.log(C.b("\n  ── Verdict ─────────────────────────────────────────────\n"));
  const leak = results.C2?.pass === true && results.C3?.pass === true;
  if (leak) {
    console.log(
      "  " +
        C.r("LEAK PRECONDITION CONFIRMED") +
        "\n\n  interrupt() leaves both the CLI process AND the message iterator\n" +
        "  alive. A cancel that deletes the activeStreams entry without\n" +
        "  calling end() therefore strands a live process behind a loop that\n" +
        "  can never exit — so its finally never runs.\n\n" +
        "  → stream-manager.ts:65  activeStreams.delete() after interrupt()\n",
    );
  } else if (results.C3?.pass === false) {
    console.log(
      "  " +
        C.g("NO LEAK") +
        "\n\n  The iterator terminates after interrupt, so the loop exits and its\n" +
        "  finally runs. cancelStream()'s delete is redundant but harmless.\n",
    );
  } else {
    console.log("  " + C.y("INCONCLUSIVE") + " — see individual claims above.\n");
  }

  const stray = diff(pidsBefore, cliPids());
  if (stray.length) {
    console.log(C.y(`  ⚠ ${stray.length} CLI process(es) still running: ${stray.join(", ")}`));
    console.log(C.d(`    kill with: kill ${stray.join(" ")}\n`));
  } else {
    console.log(C.d("  No stray CLI processes left behind by this run.\n"));
  }

  process.exit(0);
};

setTimeout(() => {
  console.log(C.r("\n  Hard timeout — aborting.\n"));
  process.exit(3);
}, HARD_TIMEOUT_MS).unref();

main().catch((e) => {
  console.error(C.r("\n  Harness error:"), e);
  process.exit(1);
});

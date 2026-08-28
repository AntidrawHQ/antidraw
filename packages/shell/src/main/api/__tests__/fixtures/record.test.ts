import "../e2e-env"; // must stay the first import — see e2e-env.ts
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildPrompt, sendMessage } from "@/main/api/claude-code-ops";

// Recorder, not a test. Regenerate the fixture with:
//   RECORD_FIXTURES=1 npx vitest run src/main/api/__tests__/fixtures/record.test.ts
// It drives one real CLI session through several turns and writes every
// SDKMessage to partials.jsonl, which live-partial.fixture.test.ts replays
// offline. In-tree rather than a loose script so it inherits vitest's TS and
// "@" alias setup and goes through the same sendMessage production uses.
const OUT = fileURLToPath(new URL("./partials.jsonl", import.meta.url));
const CLAUDE_PROJECTS = path.join(os.homedir(), ".claude", "projects");

// Shaped from what the fold actually needs to see, and from how this repo is
// really driven (Bash-heavy, then Write/Read/Edit):
//   1. several tool calls in one turn, with small inputs
//   2. a long prose answer — the previous fixture had a single text_delta,
//      so text accumulation was barely exercised
//   3. one large tool input, to fragment input_json_delta across many chunks
// Everything is written inside the throwaway workspace, never the real one.
const PROMPTS = [
  "Create three files in the current directory: a.txt containing 'alpha', " +
    "b.txt containing 'beta', and c.txt containing 'gamma'. Use a separate " +
    "tool call for each.",
  "Read all three files back and describe, in at least 150 words of prose " +
    "and no bullet points or code, what each one contains and how they relate.",
  "Write a file notes.md containing a numbered list of all three filenames " +
    "with their contents, plus a two-sentence summary paragraph for each.",
];

test.skipIf(!process.env.RECORD_FIXTURES)(
  "record a real multi-turn partial stream",
  { timeout: 600_000 },
  async () => {
    const root = process.env.ANTIDRAW_ROOT!;
    const workspaceId = crypto.randomUUID();
    mkdirSync(path.join(root, "workspaces", workspaceId, "source"), {
      recursive: true,
    });
    const before = new Set(
      existsSync(CLAUDE_PROJECTS) ? readdirSync(CLAUDE_PROJECTS) : [],
    );

    const promptStream = buildPrompt(PROMPTS[0]!, { uuid: crypto.randomUUID() });
    const res = sendMessage({ promptStream, workspaceId, model: "haiku" });
    if (res.isErr()) throw new Error("failed to start the CLI");

    const captured: SDKMessage[] = [];
    let next = 1;
    try {
      for await (const message of res.value) {
        captured.push(message);
        // One turn per prompt: the CLI's result ends a turn, so the next
        // prompt goes in through the same follow-up path the app uses.
        if (message.type === "result") {
          if (next >= PROMPTS.length) break;
          promptStream.push(PROMPTS[next++]!, { uuid: crypto.randomUUID() });
        }
      }
    } finally {
      promptStream.end();
    }

    writeFileSync(OUT, captured.map((m) => JSON.stringify(m)).join("\n") + "\n");

    // Leave nothing behind. The workspace is a throwaway temp dir, and the CLI
    // writes a session transcript under ~/.claude/projects keyed by that cwd —
    // which is pure garbage once the cwd is gone. Only directories this run
    // created are removed.
    rmSync(root, { recursive: true, force: true });
    const stale = (existsSync(CLAUDE_PROJECTS) ? readdirSync(CLAUDE_PROJECTS) : [])
      .filter((name) => !before.has(name) && name.includes(path.basename(root)));
    for (const name of stale) {
      rmSync(path.join(CLAUDE_PROJECTS, name), { recursive: true, force: true });
    }

    const kinds: Record<string, number> = {};
    const bump = (k: string) => (kinds[k] = (kinds[k] ?? 0) + 1);
    for (const m of captured) {
      if (m.type !== "stream_event") { bump(m.type); continue; }
      const e = m.event as { type: string; delta?: { type: string }; content_block?: { type: string } };
      bump(e.type === "content_block_delta" ? `delta/${e.delta!.type}`
         : e.type === "content_block_start" ? `block/${e.content_block!.type}`
         : `event/${e.type}`);
    }
    console.error(`recorded ${captured.length} messages -> ${OUT}`);
    console.error(`cleaned: temp root + ${stale.length} ~/.claude/projects dir(s)`);
    console.error(JSON.stringify(kinds, null, 2));
  },
);

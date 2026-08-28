import "../e2e-env"; // must stay the first import — see e2e-env.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildPrompt, sendMessage } from "@/main/api/claude-code-ops";

// Recorder, not a test. Regenerate the fixture with:
//   RECORD_FIXTURES=1 npx vitest run src/main/api/__tests__/fixtures/record.test.ts
// It spawns a real CLI and writes every SDKMessage of one turn to
// partials.jsonl, which live-partial.fixture.test.ts then replays offline.
// Kept in-tree (rather than as a loose script) so it inherits vitest's TS and
// "@" alias setup and calls the same sendMessage production uses.
const OUT = fileURLToPath(new URL("./partials.jsonl", import.meta.url));

// Chosen to force all three block types through the fold in one turn: a tool
// call (Write -> tool_use, whose args arrive as fragmented JSON), prose
// (text), and whatever reasoning the model emits (thinking).
const PROMPT =
  "Create a file named hello.txt containing exactly: hi. " +
  "Then reply in one short sentence saying what you did.";

test.skipIf(!process.env.RECORD_FIXTURES)(
  "record a real partial stream",
  { timeout: 300_000 },
  async () => {
    const workspaceId = crypto.randomUUID();
    mkdirSync(
      path.join(process.env.ANTIDRAW_ROOT!, "workspaces", workspaceId, "source"),
      { recursive: true },
    );

    const promptStream = buildPrompt(PROMPT, { uuid: crypto.randomUUID() });
    const res = sendMessage({ promptStream, workspaceId, model: "haiku" });
    if (res.isErr()) throw new Error("failed to start the CLI");

    const captured: SDKMessage[] = [];
    for await (const message of res.value) {
      captured.push(message);
      if (message.type === "result") break;
    }
    promptStream.end();

    writeFileSync(OUT, captured.map((m) => JSON.stringify(m)).join("\n") + "\n");

    const kinds = captured.reduce<Record<string, number>>((acc, m) => {
      const key =
        m.type === "stream_event"
          ? `stream_event/${(m as { event: { type: string } }).event.type}`
          : m.type;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    console.error("recorded", captured.length, "messages ->", OUT);
    console.error(JSON.stringify(kinds, null, 2));
  },
);

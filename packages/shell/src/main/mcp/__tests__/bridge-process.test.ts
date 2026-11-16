import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build, type Rollup } from "vite";

// `antidraw mcp` built as electron.vite.config.ts builds it, and run as an
// agent runs it: its own process, a pipe each way. With the app closed, so
// nothing else is needed.

let dir: string;
let script: string;
let imports: string[];

beforeAll(async () => {
  const [out] = [
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        target: "node22",
        lib: { entry: path.resolve(__dirname, "../bridge/main.ts"), formats: ["es"] },
        rollupOptions: { external: [/^node:/] },
      },
    }),
  ].flat() as Rollup.RollupOutput[];
  const chunk = out!.output[0];
  imports = chunk.imports;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-bridge-"));
  script = path.join(dir, "mcp-bridge.mjs");
  fs.writeFileSync(script, chunk.code);
}, 30_000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// A root as the app leaves it once closed: the token, no port; and its tools.
const closedRoot = (tools: unknown[]) => {
  const root = fs.mkdtempSync(path.join(dir, "root-"));
  fs.writeFileSync(path.join(root, "mcp.json"), JSON.stringify({ token: "t".repeat(43) }));
  fs.writeFileSync(
    path.join(root, "mcp-tools.json"),
    JSON.stringify({ protocolVersions: ["2025-06-18"], latestProtocolVersion: "2025-06-18", capabilities: {}, serverInfo: {}, tools }),
  );
  return root;
};

// Every line in, then stdin closed: what came out, and how it exited.
const run = (root: string, lines: unknown[]) =>
  new Promise<{ out: string; code: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, "mcp"], {
      env: { ...process.env, ANTIDRAW_ROOT: root },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ out, code }));
    child.stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  });

test("the built command imports only Node's own modules", () => {
  expect(imports.length).toBeGreaterThan(0);
  for (const name of imports) expect(name).toMatch(/^node:/);
});

test("an answer past a pipe's 64 KB arrives whole when the agent closes stdin straight after", async () => {
  const description = "d".repeat(200_000);
  const root = closedRoot([{ name: "big", description, inputSchema: { type: "object" } }]);
  const { out, code } = await run(root, [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
  expect(code).toBe(0);
  expect(out.endsWith("\n")).toBe(true);
  const answer = JSON.parse(out) as { id: number; result: { tools: { description: string }[] } };
  expect(answer.id).toBe(1);
  expect(answer.result.tools[0]!.description).toBe(description);
});

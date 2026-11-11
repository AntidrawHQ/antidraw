import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createBridge, postToApp, type AppAddress, type ToolCache } from "./bridge";

// `antidraw mcp`: the command an agent's config names. Built on its own to
// dist/main/mcp-bridge.mjs (electron.vite.config.ts) and run by the script
// the app leaves at <antidrawRoot>/bin/antidraw (../bridge-install.ts),
// which runs the app's own executable as Node.
//
// stdout is the agent's: one JSON message a line, nothing else.

const root = process.env.ANTIDRAW_ROOT ?? path.join(os.homedir(), ".antidraw");

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf-8")) as T;
  } catch {
    return null;
  }
};

const address = (): AppAddress | null => {
  const saved = readJson<Partial<AppAddress>>("mcp.json");
  return typeof saved?.port === "number" && typeof saved.token === "string"
    ? { port: saved.port, token: saved.token }
    : null;
};

const serve = () => {
  const bridge = createBridge({ address, cache: () => readJson<ToolCache>("mcp-tools.json"), post: postToApp });
  // The agent went away: nothing left to say.
  process.stdout.on("error", () => process.exit(0));

  const pending = new Set<Promise<void>>();
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const answering = bridge(line)
      .then((out) => {
        for (const answer of out) process.stdout.write(`${answer}\n`);
      })
      .catch((e) => console.error("[antidraw mcp]", e))
      .finally(() => pending.delete(answering));
    pending.add(answering);
  });
  lines.on("close", () => void Promise.all(pending).then(() => process.exit(0)));
};

if (process.argv[2] === "mcp") serve();
else {
  console.error("Usage: antidraw mcp\n\nConnects a coding agent to the Antidraw app over MCP (stdio).");
  process.exit(2);
}

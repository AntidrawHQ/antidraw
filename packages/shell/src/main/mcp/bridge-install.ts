import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { getAntidrawRoot } from "@/main/api/init";
import type { ToolCache } from "./bridge/bridge";
import { createMcpServer } from "./server";
import type { ToolDeps } from "./types";

// What `antidraw mcp` (./bridge) needs on disk, left there on each launch:
// the command itself, and the server's tool list for when the app is closed.

export const toolCachePath = () => path.join(getAntidrawRoot(), "mcp-tools.json");

// What agents' configs name: it stays put while the app moves or updates.
export const bridgeCommandPath = () => path.join(getAntidrawRoot(), "bin", "antidraw");

// Whole or not at all: an agent may be reading it, or running it.
const replace = (file: string, content: string, mode: number) => {
  try {
    if (fs.readFileSync(file, "utf-8") === content && (fs.statSync(file).mode & 0o777) === mode) return;
  } catch {
    // Not there yet.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(next, content, { mode });
  fs.chmodSync(next, mode);
  fs.renameSync(next, file);
};

// The server's own answers, asked of it as a client would: what the bridge
// gives an agent that connects while the app is closed.
export const writeToolCache = async (deps: ToolDeps) => {
  const server = createMcpServer(deps);
  const client = new Client({ name: "antidraw", version: "1.0.0" });
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(theirs), client.connect(ours)]);
  try {
    const { tools } = await client.listTools();
    const cache: ToolCache = {
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      latestProtocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: client.getServerCapabilities() ?? {},
      serverInfo: client.getServerVersion() ?? {},
      instructions: client.getInstructions(),
      tools,
    };
    replace(toolCachePath(), `${JSON.stringify(cache, null, 2)}\n`, 0o644);
  } finally {
    await client.close();
    await server.close();
  }
};

const quoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

// The app's executable, run as Node on the bridge's script.
export const bridgeScript = ({ executable, script, root }: { executable: string; script: string; root: string }) =>
  `#!/bin/sh
# Antidraw's command for coding agents: \`antidraw mcp\`.
# Written by the app each time it opens; edits here are lost.
ANTIDRAW_ROOT=${quoted(root)} ELECTRON_RUN_AS_NODE=1 exec ${quoted(executable)} ${quoted(script)} "$@"
`;

// Beside main's bundle; in a packaged app, outside its archive (asarUnpack).
const bridgeScriptPath = () => path.join(__dirname, "mcp-bridge.mjs").replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");

export const installBridgeCommand = () =>
  replace(
    bridgeCommandPath(),
    bridgeScript({ executable: process.execPath, script: bridgeScriptPath(), root: getAntidrawRoot() }),
    0o755,
  );

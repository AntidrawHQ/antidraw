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

// What the command runs: an app's executable, as Node, on its bridge script.
export type BridgeTarget = { executable: string; script: string };

// The app where it's installed: what the command runs when the copy that
// last opened is gone (opened from its DMG, or a download, or a dev
// checkout since deleted).
export const INSTALLED_APP: BridgeTarget = {
  executable: "/Applications/Antidraw.app/Contents/MacOS/Antidraw",
  script: "/Applications/Antidraw.app/Contents/Resources/app.asar.unpacked/dist/main/mcp-bridge.mjs",
};

// The copy that last opened, else the fallback, else a reason on stderr,
// which agents keep in their MCP logs.
export const bridgeScript = ({ executable, script, root, fallback }: BridgeTarget & { root: string; fallback?: BridgeTarget }) => {
  const missing = `[ ! -x "$app" ] || [ ! -f "$script" ]`;
  const fallBack = fallback
    ? `if ${missing}; then
  app=${quoted(fallback.executable)}
  script=${quoted(fallback.script)}
fi
`
    : "";
  const where = fallback ? `, or at ${/^(.*?\.app)\//.exec(fallback.executable)?.[1] ?? fallback.executable}` : "";
  const lost = `antidraw: Antidraw isn't where it last opened from${where}. Open it once from where it's installed, then try again.`;
  return `#!/bin/sh
# Antidraw's command for coding agents: \`antidraw mcp\`.
# Written by the app each time it opens; edits here are lost.
app=${quoted(executable)}
script=${quoted(script)}
${fallBack}if ${missing}; then
  echo ${quoted(lost)} >&2
  exit 1
fi
ANTIDRAW_ROOT=${quoted(root)} ELECTRON_RUN_AS_NODE=1 exec "$app" "$script" "$@"
`;
};

// Beside main's bundle; in a packaged app, outside its archive (asarUnpack).
const bridgeScriptPath = () => path.join(__dirname, "mcp-bridge.mjs").replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");

// Opened from somewhere that won't last: the DMG it came on, or the copy
// macOS runs a downloaded app from until it's moved (App Translocation).
export const isTransient = (executable: string) =>
  executable.startsWith("/Volumes/") || executable.includes("/AppTranslocation/");

// Whether the command an earlier launch left still finds its app.
const stillRuns = (file: string) => {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return false;
  }
  const value = (name: string) =>
    new RegExp(String.raw`^${name}='((?:[^']|'\\'')*)'$`, "m").exec(text)?.[1]?.replaceAll(`'\\''`, "'");
  const [app, script] = [value("app"), value("script")];
  return !!app && !!script && fs.existsSync(app) && fs.existsSync(script);
};

export const installBridgeCommand = ({ executable = process.execPath, platform = process.platform } = {}) => {
  const file = bridgeCommandPath();
  // A command that still runs isn't swapped for one that soon won't.
  if (isTransient(executable) && stillRuns(file)) return;
  const fallback = platform === "darwin" && executable !== INSTALLED_APP.executable ? INSTALLED_APP : undefined;
  replace(file, bridgeScript({ executable, script: bridgeScriptPath(), root: getAntidrawRoot(), fallback }), 0o755);
};

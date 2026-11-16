import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getAntidrawRoot } from "@/main/api/init";

// The token a client sends, and the port the MCP server listens on while
// the app is open, kept in <antidrawRoot>/mcp.json (only the user may read
// it). The token is made once and kept: an agent set up with the URL and
// token names it. `antidraw mcp` reads the port on each message, so agents
// that use it don't mind which port it is; the server prefers this one (or
// ANTIDRAW_MCP_PORT) for agents set up with the URL, and takes a free one
// when it's taken (./server.ts). The port is in the file only while a
// server listens on it.

export const MCP_DEFAULT_PORT = 47821;

export type McpConfig = { port?: number; token: string };

export const mcpConfigPath = () => path.join(getAntidrawRoot(), "mcp.json");

export const mcpPort = () => {
  const raw = process.env.ANTIDRAW_MCP_PORT;
  if (!raw) return MCP_DEFAULT_PORT;
  const port = Number(raw);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  console.error(`[mcp] ignoring ANTIDRAW_MCP_PORT=${raw}: not a port`);
  return MCP_DEFAULT_PORT;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43,}$/;

const read = (file: string): Partial<McpConfig> => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<McpConfig>;
  } catch {
    return {};
  }
};

const write = (file: string, config: McpConfig) => {
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFile's mode is only a new file's.
  fs.chmodSync(file, 0o600);
};

// The token, made once (32 random bytes) and kept. A port left by a launch
// that didn't quit cleanly goes: nothing listens there until this launch
// says so (saveMcpPort).
export const loadMcpToken = (): string => {
  const file = mcpConfigPath();
  const saved = read(file);
  const token = typeof saved.token === "string" && TOKEN_RE.test(saved.token) ? saved.token : randomBytes(32).toString("base64url");
  if (saved.token !== token || saved.port !== undefined) write(file, { token });
  else fs.chmodSync(file, 0o600);
  return token;
};

// Where this launch's server listens, once it does: what `antidraw mcp` reads.
export const saveMcpPort = (token: string, port: number) => write(mcpConfigPath(), { port, token });

// Back in, when another launch that took the file over (a dev build beside
// an installed one) has quit and taken its port out: this one still listens.
export const reclaimMcpPort = (token: string, port: number) => {
  if (read(mcpConfigPath()).port === undefined) saveMcpPort(token, port);
};

// Not listening any more, as the app quits; unless another launch (a dev
// build beside an installed one) has since written its own port.
export const clearMcpPort = (port: number) => {
  const file = mcpConfigPath();
  const saved = read(file);
  if (saved.port === port && typeof saved.token === "string") write(file, { token: saved.token });
};

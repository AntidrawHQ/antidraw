import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getAntidrawRoot } from "@/main/api/init";

// Where the MCP server listens and the token a client sends, kept in
// <antidrawRoot>/mcp.json (only the user may read it): both go into the
// agents' configs, so neither changes between launches. A fixed port, not
// a free one, for the same reason; ANTIDRAW_MCP_PORT moves it.

export const MCP_DEFAULT_PORT = 47821;

export type McpConfig = { port: number; token: string };

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

// The token made once (32 random bytes), and the port this launch listens
// on, written back so the file says where the server is.
export const loadMcpConfig = (port: number): McpConfig => {
  const file = mcpConfigPath();
  const saved = read(file);
  const token = typeof saved.token === "string" && TOKEN_RE.test(saved.token) ? saved.token : randomBytes(32).toString("base64url");
  const config = { port, token };
  if (saved.token !== token || saved.port !== port)
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFile's mode is only a new file's.
  fs.chmodSync(file, 0o600);
  return config;
};

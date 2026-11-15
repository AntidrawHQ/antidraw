import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { err, ok, type Result } from "neverthrow";
import type { McpAgentId } from "@/shared/mcp-agents";
import { addCodexServer, codexHasServer } from "./codex-toml";
import { getIn, readJsonc, setInJsonc, type Json } from "./jsonc";

// Where each coding agent keeps the MCP servers it starts for every
// project, and what `antidraw mcp` looks like there. Each was checked
// against the agent itself or its documentation (November 2026):
//
//   Claude Code  ~/.claude.json                  mcpServers.antidraw   (as `claude mcp add --scope user` writes it)
//   Codex        ~/.codex/config.toml            [mcp_servers.antidraw] (the CLI, the IDE extension and the app share it)
//   Cursor       ~/.cursor/mcp.json              mcpServers.antidraw
//   VS Code      <its User folder>/mcp.json      servers.antidraw
//   opencode     ~/.config/opencode/opencode.json(c)  mcp.antidraw, or mcp.servers.antidraw where the file has that map
//   pi           ~/.pi/agent/mcp.json            mcpServers.antidraw   (as `pi mcp add` writes it; pi 1.0 and later)
//
// Adding the server changes only that entry: the rest of the file keeps its
// text (./jsonc.ts, ./codex-toml.ts).

// What decides where the configs are; a test's own.
export type Machine = { home: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform };

export const thisMachine = (): Machine => ({ home: os.homedir(), env: process.env, platform: process.platform });

const NAME = "antidraw";
const ARGS = ["mcp"];

type Agent = {
  file: (machine: Machine) => string;
  // Whether the config's text already runs `<bridge> mcp`.
  has: (text: string, bridge: string) => boolean;
  // The text with it added: the same text when it's there already.
  add: (text: string, bridge: string) => Result<string, string>;
};

const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// A server as most agents write one: its command, and its arguments apart.
const runsCommand = (entry: Json | undefined, bridge: string) =>
  isObject(entry) && entry.command === bridge && isDeepStrictEqual(entry.args, ARGS);

// An agent whose servers are a JSON object of entries by name.
const jsonAgent = (
  file: Agent["file"],
  servers: string,
  entry: (bridge: string) => Json,
): Agent => {
  const has: Agent["has"] = (text, bridge) =>
    readJsonc(text)
      .map((config) => runsCommand(getIn(config, [servers, NAME]), bridge))
      .unwrapOr(false);
  return {
    file,
    has,
    add: (text, bridge) => (has(text, bridge) ? ok(text) : setInJsonc(text, [servers, NAME], entry(bridge))),
  };
};

// opencode's servers are `mcp.<name>`; a newer config keeps them a level
// down, in `mcp.servers`, and a server goes where the file's others are.
// Its command is one list, arguments included.
const opencode = ((): Agent => {
  const isServer = (value: Json | undefined) =>
    isObject(value) && (typeof value.type === "string" || "command" in value || "url" in value);
  const runs = (entry: Json | undefined, bridge: string) =>
    isObject(entry) && isDeepStrictEqual(entry.command, [bridge, ...ARGS]);
  const nested = (config: Json | undefined) => {
    const servers = getIn(config, ["mcp", "servers"]);
    return isObject(servers) && !isServer(servers);
  };
  const has: Agent["has"] = (text, bridge) =>
    readJsonc(text)
      .map((config) => runs(getIn(config, ["mcp", "servers", NAME]), bridge) || runs(getIn(config, ["mcp", NAME]), bridge))
      .unwrapOr(false);

  return {
    file: ({ home, env }) => {
      const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
      const withComments = path.join(dir, "opencode.jsonc");
      return fs.existsSync(withComments) ? withComments : path.join(dir, "opencode.json");
    },
    has,
    add: (text, bridge) => {
      if (has(text, bridge)) return ok(text);
      const command = [bridge, ...ARGS];
      return readJsonc(text)
        .mapErr((e) => `it isn't valid JSON (${e})`)
        .andThen((config) =>
          nested(config)
            ? setInJsonc(text, ["mcp", "servers", NAME], { type: "local", command })
            : setInJsonc(text, ["mcp", NAME], { type: "local", command, enabled: true }),
        );
    },
  };
})();

// VS Code's User folder, per platform.
const vscodeUser = ({ home, env, platform }: Machine) =>
  platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Code", "User")
    : platform === "win32"
      ? path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User")
      : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Code", "User");

const AGENTS: Record<McpAgentId, Agent> = {
  claude: jsonAgent(
    ({ home, env }) => path.join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"),
    "mcpServers",
    (command) => ({ type: "stdio", command, args: ARGS, env: {} }),
  ),
  codex: {
    file: ({ home, env }) => path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"),
    has: codexHasServer,
    add: addCodexServer,
  },
  cursor: jsonAgent(
    ({ home }) => path.join(home, ".cursor", "mcp.json"),
    "mcpServers",
    (command) => ({ command, args: ARGS }),
  ),
  vscode: jsonAgent(
    (machine) => path.join(vscodeUser(machine), "mcp.json"),
    "servers",
    (command) => ({ type: "stdio", command, args: ARGS }),
  ),
  opencode,
  pi: jsonAgent(
    ({ home, env }) => path.join(env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"), "mcp.json"),
    "mcpServers",
    (command) => ({ command, args: ARGS }),
  ),
};

export const agentConfigFile = (id: McpAgentId, machine: Machine = thisMachine()) => AGENTS[id].file(machine);

// A path as it's said to its owner: under the home directory, from ~.
export const fromHome = (file: string, { home }: Machine = thisMachine()) =>
  file === home || file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;

// The file's text; null when there's no file.
const readIfThere = (file: string): Result<string | null, string> => {
  try {
    return ok(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? ok(null) : err(`it couldn't be read (${code ?? "unknown error"})`);
  }
};

// Where a write goes: a config that's a link (a dotfiles folder's, say)
// stays one, and what it points at is written.
const target = (file: string) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

// Whole or not at all: the agent may be reading it. A new file is the user's alone.
const writeWhole = (file: string, content: string): Result<void, string> => {
  const next = `${file}.antidraw-${process.pid}.tmp`;
  try {
    let mode = 0o600;
    try {
      mode = fs.statSync(file).mode & 0o777;
    } catch {
      // Not there yet.
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(next, content, { mode });
    fs.chmodSync(next, mode);
    fs.renameSync(next, file);
    return ok(undefined);
  } catch (e) {
    fs.rmSync(next, { force: true });
    return err(`it couldn't be written (${(e as NodeJS.ErrnoException).code ?? "unknown error"})`);
  }
};

export const hasAgentServer = (id: McpAgentId, bridge: string, machine: Machine = thisMachine()) =>
  readIfThere(AGENTS[id].file(machine))
    .map((text) => text !== null && AGENTS[id].has(text, bridge))
    .unwrapOr(false);

// How often a config that changed while it was being edited is read again.
const TRIES = 3;

/**
 * Adds `<bridge> mcp` to the agent's config as its "antidraw" server. The
 * error says why the file was left as it was.
 */
export const addAgentServer = (id: McpAgentId, bridge: string, machine: Machine = thisMachine()): Result<void, string> => {
  const agent = AGENTS[id];
  const file = target(agent.file(machine));

  for (let tries = 0; tries < TRIES; tries++) {
    const before = readIfThere(file);
    if (before.isErr()) return err(before.error);
    const next = agent.add(before.value ?? "", bridge);
    if (next.isErr()) return err(next.error);
    if (next.value === before.value) return ok(undefined);

    // An agent writes its config too (Claude Code's is its state): one that
    // changed since it was read is read again, not written over.
    const now = readIfThere(file);
    if (now.isErr()) return err(now.error);
    if (now.value !== before.value) continue;
    return writeWhole(file, next.value);
  }
  return err("it kept changing while it was being edited");
};

// The agent's own "install this MCP server" link, for the two that have one.
export const agentInstallLink = (id: McpAgentId, bridge: string): string | null => {
  const server = { command: bridge, args: ARGS };
  if (id === "cursor") {
    const config = Buffer.from(JSON.stringify(server)).toString("base64");
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${encodeURIComponent(config)}`;
  }
  if (id === "vscode") return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, ...server }))}`;
  return null;
};

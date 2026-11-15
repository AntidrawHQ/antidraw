import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAgentServer, agentConfigFile, agentInstallLink, hasAgentServer, type Machine } from "../setup/agents";
import { addCodexServer, codexHasServer } from "../setup/codex-toml";
import { readJsonc, setInJsonc } from "../setup/jsonc";
import { shellCommand } from "../setup";

// One-click "Add": `antidraw mcp` written into a coding agent's own config,
// the rest of the file left as its owner wrote it.

const BRIDGE = "/Users/me/.antidraw/bin/antidraw";
const SERVER = { command: BRIDGE, args: ["mcp"] };

describe("a JSON config", () => {
  const set = (text: string, value: unknown = SERVER) =>
    setInJsonc(text, ["mcpServers", "antidraw"], value as never)._unsafeUnwrap();

  it("is made when there's none", () => {
    expect(set("")).toBe(`{
  "mcpServers": {
    "antidraw": {
      "command": "/Users/me/.antidraw/bin/antidraw",
      "args": [
        "mcp"
      ]
    }
  }
}
`);
  });

  it("gets the server after its others, the rest of its text untouched", () => {
    const before = `{
    "numStartups": 12,
    "mcpServers": {
        "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }
    },
    "projects": { "/Users/me/antidraw": { "allowedTools": [] } }
}`;
    expect(set(before, { command: "a" })).toBe(`{
    "numStartups": 12,
    "mcpServers": {
        "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" },
        "antidraw": {
            "command": "a"
        }
    },
    "projects": { "/Users/me/antidraw": { "allowedTools": [] } }
}`);
  });

  it("gets the servers' object when it has none, and fills an empty one", () => {
    expect(set(`{\n\t"theme": "dark"\n}\n`, 1)).toBe(`{\n\t"theme": "dark",\n\t"mcpServers": {\n\t\t"antidraw": 1\n\t}\n}\n`);
    expect(set(`{\n  "mcpServers": {}\n}\n`, 1)).toBe(`{\n  "mcpServers": {\n    "antidraw": 1\n  }\n}\n`);
    expect(set(`{}`, 1)).toBe(`{\n  "mcpServers": {\n    "antidraw": 1\n  }\n}`);
    expect(set(`{"a":1}`, 1)).toBe(`{"a":1, "mcpServers": {"antidraw":1}}`);
  });

  it("keeps comments and trailing commas where they are", () => {
    const before = `// My servers.
{
  "mcpServers": {
    /* The one I use. */
    "github": { "command": "gh-mcp" }, // keep
  },
}
`;
    expect(set(before, { command: "a" })).toBe(`// My servers.
{
  "mcpServers": {
    /* The one I use. */
    "github": { "command": "gh-mcp" }, // keep
    "antidraw": {
      "command": "a"
    },
  },
}
`);
    // The last member's comment stays beside it, and it gets its comma.
    expect(set(`{\n  "mcpServers": {\n    "a": 1 // one\n  }\n}`, 2)).toBe(
      `{\n  "mcpServers": {\n    "a": 1, // one\n    "antidraw": 2\n  }\n}`,
    );
  });

  it("has the server it already names replaced, whatever was there", () => {
    const before = `{
  "mcpServers": {
    "antidraw": { "type": "http", "url": "http://127.0.0.1:47821/mcp", "headers": { "Authorization": "Bearer x" } },
    "other": {}
  }
}`;
    expect(set(before, { command: "a" })).toBe(`{
  "mcpServers": {
    "antidraw": {
      "command": "a"
    },
    "other": {}
  }
}`);
  });

  it("is left alone when it can't be read as one", () => {
    for (const text of [`{ "mcpServers": `, `[1, 2]`, `{ "mcpServers": [] }`, `{ "mcpServers": "none" }`, `{ a: 1 }`, `{} {}`])
      expect([text, setInJsonc(text, ["mcpServers", "antidraw"], 1).isErr()]).toEqual([text, true]);
  });

  it("reads strings that hold what looks like its syntax", () => {
    const before = `{ "note": "a } // not a comment, \\" { ", "url": "http://x/*y*/" }`;
    const after = set(before, 1);
    expect(readJsonc(after)._unsafeUnwrap()).toEqual({
      note: 'a } // not a comment, " { ',
      url: "http://x/*y*/",
      mcpServers: { antidraw: 1 },
    });
  });
});

describe("Codex's config.toml", () => {
  const add = (text: string) => addCodexServer(text, BRIDGE);
  const TABLE = `[mcp_servers.antidraw]\ncommand = "/Users/me/.antidraw/bin/antidraw"\nargs = ["mcp"]\n`;

  it("gets the server's table at its end", () => {
    expect(add("")._unsafeUnwrap()).toBe(TABLE);
    expect(add(`model = "gpt-5"`)._unsafeUnwrap()).toBe(`model = "gpt-5"\n\n${TABLE}`);
    const before = `model = "gpt-5"

[projects."/Users/me/personal/antidraw"]
trust_level = "trusted"

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"

[mcp_servers.linear.env]
antidraw = "not a server"
`;
    expect(add(before)._unsafeUnwrap()).toBe(`${before}\n${TABLE}`);
    expect(codexHasServer(before, BRIDGE)).toBe(false);
    expect(codexHasServer(`${before}\n${TABLE}`, BRIDGE)).toBe(true);
  });

  it("is unchanged when the server is there already, however it's quoted", () => {
    for (const text of [
      TABLE,
      `[mcp_servers.antidraw]\nargs = [ 'mcp', ]  # the bridge\ncommand = '/Users/me/.antidraw/bin/antidraw'\nenabled = true\n\n[mcp_servers.antidraw.tools.get_comments]\napproval_mode = "approve"\n`,
      `[ mcp_servers . "antidraw" ]\ncommand = "/Users/me/.antidraw/bin/antidraw"\nargs = ["mcp"]`,
    ]) {
      expect([text, codexHasServer(text, BRIDGE)]).toEqual([text, true]);
      expect(add(text)._unsafeUnwrap()).toBe(text);
    }
  });

  it("is left alone when it already says something else about the server", () => {
    for (const text of [
      // Another command, or a server reached another way.
      `[mcp_servers.antidraw]\ncommand = "/somewhere/else/antidraw"\nargs = ["mcp"]\n`,
      `[mcp_servers.antidraw]\nurl = "http://127.0.0.1:47821/mcp"\n`,
      `[mcp_servers.antidraw]\ncommand = "/Users/me/.antidraw/bin/antidraw"\nargs = [\n  "mcp",\n]\n`,
      // Written where a table of its own would be a second definition.
      `mcp_servers = { antidraw = { command = "x" } }\n`,
      `mcp_servers = {}\n`,
      `mcp_servers.antidraw.command = "x"\n`,
      `[mcp_servers]\nantidraw = { command = "x" }\n`,
      `[mcp_servers]\nantidraw.command = "x"\n`,
      `[[mcp_servers]]\nname = "x"\n`,
      `${TABLE}\n${TABLE}`,
      // Not TOML to the end.
      `notes = """\nnever closed\n`,
    ]) {
      expect([text, add(text).isErr(), codexHasServer(text, BRIDGE)]).toEqual([text, true, false]);
    }
  });

  it("isn't misled by what only looks like the server's table", () => {
    const before = `notes = """
[mcp_servers.antidraw]
command = "in a string"
"""
allow = [
  ["mcp_servers.antidraw"],
]
# [mcp_servers.antidraw]
title = "[mcp_servers.antidraw]" # [mcp_servers.antidraw]
`;
    expect(codexHasServer(before, BRIDGE)).toBe(false);
    expect(add(before)._unsafeUnwrap()).toBe(`${before}\n${TABLE}`);
  });
});

describe("an agent's config on disk", () => {
  let home: string;
  let machine: Machine;

  beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-setup-")));
    machine = { home, env: {}, platform: "darwin" };
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const config = (id: Parameters<typeof agentConfigFile>[0]) => agentConfigFile(id, machine);
  const read = (file: string) => fs.readFileSync(file, "utf-8");
  const json = (file: string) => JSON.parse(read(file)) as unknown;
  const put = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  it("is where each agent reads it", () => {
    const at = (m: Machine) =>
      (["claude", "codex", "cursor", "vscode", "opencode", "pi"] as const).map((id) =>
        path.relative(home, agentConfigFile(id, m)),
      );
    expect(at(machine)).toEqual([
      ".claude.json",
      ".codex/config.toml",
      ".cursor/mcp.json",
      "Library/Application Support/Code/User/mcp.json",
      ".config/opencode/opencode.json",
      ".pi/agent/mcp.json",
    ]);
    // Moved by the variables each agent reads itself.
    const env = {
      CLAUDE_CONFIG_DIR: path.join(home, "claude"),
      CODEX_HOME: path.join(home, "codex"),
      XDG_CONFIG_HOME: path.join(home, "xdg"),
      PI_CODING_AGENT_DIR: path.join(home, "pi"),
    };
    expect(at({ home, env, platform: "linux" })).toEqual([
      "claude/.claude.json",
      "codex/config.toml",
      ".cursor/mcp.json",
      "xdg/Code/User/mcp.json",
      "xdg/opencode/opencode.json",
      "pi/mcp.json",
    ]);
    // opencode's config with comments, when that's the one there.
    put(path.join(home, ".config/opencode/opencode.jsonc"), "{}");
    expect(path.relative(home, config("opencode"))).toBe(".config/opencode/opencode.jsonc");
  });

  it("gets the server as each agent writes one", () => {
    for (const id of ["claude", "codex", "cursor", "vscode", "opencode", "pi"] as const) {
      expect([id, hasAgentServer(id, BRIDGE, machine)]).toEqual([id, false]);
      expect(addAgentServer(id, BRIDGE, machine).isOk()).toBe(true);
      expect([id, hasAgentServer(id, BRIDGE, machine)]).toEqual([id, true]);
    }
    expect(json(config("claude"))).toEqual({ mcpServers: { antidraw: { type: "stdio", ...SERVER, env: {} } } });
    expect(json(config("cursor"))).toEqual({ mcpServers: { antidraw: SERVER } });
    expect(json(config("vscode"))).toEqual({ servers: { antidraw: { type: "stdio", ...SERVER } } });
    expect(json(config("pi"))).toEqual({ mcpServers: { antidraw: SERVER } });
    expect(json(config("opencode"))).toEqual({
      mcp: { antidraw: { type: "local", command: [BRIDGE, "mcp"], enabled: true } },
    });
    expect(read(config("codex"))).toBe(`[mcp_servers.antidraw]\ncommand = "${BRIDGE}"\nargs = ["mcp"]\n`);
    // A new config is its owner's alone.
    expect(fs.statSync(config("claude")).mode & 0o777).toBe(0o600);
  });

  it("puts opencode's server where the config keeps its others", () => {
    put(config("opencode"), `{ "mcp": { "servers": { "docs": { "type": "remote", "url": "https://x" } } } }`);
    expect(addAgentServer("opencode", BRIDGE, machine).isOk()).toBe(true);
    expect(json(config("opencode"))).toEqual({
      mcp: { servers: { docs: { type: "remote", url: "https://x" }, antidraw: { type: "local", command: [BRIDGE, "mcp"] } } },
    });
    expect(hasAgentServer("opencode", BRIDGE, machine)).toBe(true);

    // A server that happens to be named "servers" is a server, not that map.
    put(config("opencode"), `{ "mcp": { "servers": { "type": "local", "command": ["x"] } } }`);
    expect(addAgentServer("opencode", BRIDGE, machine).isOk()).toBe(true);
    expect(json(config("opencode"))).toMatchObject({ mcp: { antidraw: { type: "local", enabled: true } } });
  });

  it("writes nothing when the server is there, and keeps the file's mode when it isn't", () => {
    put(config("cursor"), `{ "mcpServers": { "antidraw": ${JSON.stringify({ ...SERVER, env: { A: "1" } })} } }`);
    fs.chmodSync(config("cursor"), 0o640);
    const before = fs.statSync(config("cursor"));
    expect(addAgentServer("cursor", BRIDGE, machine).isOk()).toBe(true);
    expect(fs.statSync(config("cursor")).ino).toBe(before.ino);

    // Another command under the name: the entry is replaced.
    expect(addAgentServer("cursor", "/moved/antidraw", machine).isOk()).toBe(true);
    expect(json(config("cursor"))).toEqual({ mcpServers: { antidraw: { command: "/moved/antidraw", args: ["mcp"] } } });
    expect(fs.statSync(config("cursor")).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(path.dirname(config("cursor")))).toEqual(["mcp.json"]);
  });

  it("writes through a link to the config, leaving the link", () => {
    const real = path.join(home, "dotfiles", "claude.json");
    put(real, `{\n  "numStartups": 3\n}\n`);
    fs.symlinkSync(real, config("claude"));
    expect(addAgentServer("claude", BRIDGE, machine).isOk()).toBe(true);
    expect(fs.lstatSync(config("claude")).isSymbolicLink()).toBe(true);
    expect(json(real)).toMatchObject({ numStartups: 3, mcpServers: { antidraw: SERVER } });
  });

  it("leaves a config it can't read as it is, and says why", () => {
    put(config("vscode"), `{ "servers": { `);
    put(config("codex"), `[mcp_servers.antidraw]\nurl = "http://127.0.0.1:47821/mcp"\n`);
    expect(addAgentServer("vscode", BRIDGE, machine)._unsafeUnwrapErr()).toMatch(/^it isn't valid JSON/);
    expect(addAgentServer("codex", BRIDGE, machine)._unsafeUnwrapErr()).toBe(
      "it already has an antidraw server, set up another way",
    );
    expect(read(config("vscode"))).toBe(`{ "servers": { `);
    expect([hasAgentServer("vscode", BRIDGE, machine), hasAgentServer("codex", BRIDGE, machine)]).toEqual([false, false]);
  });
});

it("writes the command as a shell takes it, and as each agent's install link does", () => {
  const machine: Machine = { home: "/Users/me", env: {}, platform: "darwin" };
  expect(shellCommand(BRIDGE, machine)).toBe("~/.antidraw/bin/antidraw");
  expect(shellCommand("/opt/antidraw/bin/antidraw", machine)).toBe("/opt/antidraw/bin/antidraw");
  // A home with a space in it is still ~; a path with one elsewhere is quoted.
  expect(shellCommand("/Users/my name/.antidraw/bin/antidraw", { ...machine, home: "/Users/my name" })).toBe(
    "~/.antidraw/bin/antidraw",
  );
  expect(shellCommand("/Volumes/it's here/antidraw", machine)).toBe(`'/Volumes/it'\\''s here/antidraw'`);

  const cursor = new URL(agentInstallLink("cursor", BRIDGE)!);
  expect(`${cursor.protocol}//${cursor.host}${cursor.pathname}`).toBe("cursor://anysphere.cursor-deeplink/mcp/install");
  expect(cursor.searchParams.get("name")).toBe("antidraw");
  expect(JSON.parse(Buffer.from(cursor.searchParams.get("config")!, "base64").toString())).toEqual(SERVER);

  const vscode = agentInstallLink("vscode", BRIDGE)!;
  expect(vscode.startsWith("vscode:mcp/install?")).toBe(true);
  expect(JSON.parse(decodeURIComponent(vscode.slice("vscode:mcp/install?".length)))).toEqual({ name: "antidraw", ...SERVER });

  expect(agentInstallLink("claude", BRIDGE)).toBeNull();
});

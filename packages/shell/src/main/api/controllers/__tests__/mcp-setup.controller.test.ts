import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";

// The setup's routes over a throwaway home: what they tell the page, the
// config an "Add" writes, and the only links they'll open.

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-setup-routes-")));
const bridge = path.join(home, ".antidraw", "bin", "antidraw");
const openExternal = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ shell: { openExternal } }));
vi.mock("@/main/mcp/bridge-install", () => ({ bridgeCommandPath: () => bridge }));
vi.mock("node:os", async (original) => {
  const actual = await original<typeof import("node:os")>();
  return { ...actual, default: { ...actual, homedir: () => home }, homedir: () => home };
});

const { mcpSetupController } = await import("@/main/api/controllers/mcp-setup.controller");

const post = (route: string) => mcpSetupController.request(route, { method: "POST" });
const added = async () => {
  const { agents } = (await (await mcpSetupController.request("/")).json()) as {
    agents: Record<string, { added: boolean }>;
  };
  return Object.keys(agents).filter((id) => agents[id]!.added);
};

// The variables that move an agent's config out of the home directory: the
// developer's own would point the routes at their real configs.
const CONFIG_ENV = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR", "APPDATA"];

beforeEach(() => {
  for (const name of CONFIG_ENV) vi.stubEnv(name, "");
  openExternal.mockReset();
  openExternal.mockResolvedValue(undefined);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(bridge), { recursive: true });
  fs.writeFileSync(bridge, "#!/bin/sh\n", { mode: 0o755 });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

test("says the command, as a config and as a shell take it, and which agents have it", async () => {
  const res = await mcpSetupController.request("/");
  expect(await res.json()).toEqual({
    command: bridge,
    shellCommand: "~/.antidraw/bin/antidraw",
    agents: {
      claude: { added: false },
      codex: { added: false },
      cursor: { added: false },
      vscode: { added: false },
      opencode: { added: false },
      pi: { added: false },
    },
  });
});

test("adds the command to the agent's config, once", async () => {
  expect((await post("/cursor/add")).status).toBe(200);
  expect(JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf-8"))).toEqual({
    mcpServers: { antidraw: { command: bridge, args: ["mcp"] } },
  });
  expect(await added()).toEqual(["cursor"]);

  expect((await post("/codex/add")).status).toBe(200);
  expect((await post("/codex/add")).status).toBe(200);
  expect(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf-8")).toBe(
    `[mcp_servers.antidraw]\ncommand = ${JSON.stringify(bridge)}\nargs = ["mcp"]\n`,
  );
  expect(await added()).toEqual(["codex", "cursor"]);
});

test("says why a config was left as it was", async () => {
  const config = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, `[mcp_servers.antidraw]\nurl = "http://127.0.0.1:47821/mcp"\n`);

  const res = await post("/codex/add");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: {
      code: "CONFIG_NOT_CHANGED",
      message: "config.toml wasn't changed: it already has an antidraw server, set up another way.",
    },
  });
  expect(fs.readFileSync(config, "utf-8")).toBe(`[mcp_servers.antidraw]\nurl = "http://127.0.0.1:47821/mcp"\n`);
});

test("writes no config while the command isn't in place", async () => {
  fs.rmSync(bridge);
  const res = await post("/claude/add");
  expect(res.status).toBe(500);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("COMMAND_MISSING");
  expect(fs.existsSync(path.join(home, ".claude.json"))).toBe(false);
});

test("opens only an agent's own install link, made here", async () => {
  expect((await post("/cursor/install-link")).status).toBe(200);
  expect((await post("/vscode/install-link")).status).toBe(200);
  expect(openExternal.mock.calls.map(([url]) => (url as string).split("?")[0])).toEqual([
    "cursor://anysphere.cursor-deeplink/mcp/install",
    "vscode:mcp/install",
  ]);

  // An agent without one, and one that isn't an agent.
  expect((await post("/claude/install-link")).status).toBe(409);
  expect((await post("/other/install-link")).status).toBe(400);
  expect((await post("/other/add")).status).toBe(400);
  expect(openExternal).toHaveBeenCalledTimes(2);

  // The agent isn't installed: nothing to open the link.
  openExternal.mockRejectedValue(new Error("no handler"));
  expect((await post("/cursor/install-link")).status).toBe(500);
});

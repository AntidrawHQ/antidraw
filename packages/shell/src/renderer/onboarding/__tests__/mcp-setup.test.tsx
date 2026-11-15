// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpSetup as Setup } from "@/shared/mcp-agents";

// The MCP setup at its two sizes: the titlebar's button and menu, and the
// onboarding page's rows, with main's API faked. Both read one store of the
// agents' states, over what main says their configs hold.

const api = vi.hoisted(() => ({
  getMcpSetup: vi.fn(),
  addMcpToAgent: vi.fn(),
  openMcpInstallLink: vi.fn(),
}));
vi.mock("@/renderer/lib/api", () => api);

const { McpSetup } = await import("@/renderer/components/McpSetup");
const { useAgentStatesStore } = await import("../agent-states");
const { AGENTS } = await import("../agents");
const { TwoWaysRows } = await import("../TwoWaysRows");

const BRIDGE = "/Users/me/.antidraw/bin/antidraw";
const setup = (added: string[] = []): Setup => ({
  command: BRIDGE,
  shellCommand: "~/.antidraw/bin/antidraw",
  agents: Object.fromEntries(
    ["claude", "codex", "cursor", "vscode", "opencode", "pi"].map((id) => [id, { added: added.includes(id) }]),
  ) as Setup["agents"],
});

let root: Root | null = null;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMcpSetup.mockResolvedValue(ok(setup()));
  api.addMcpToAgent.mockResolvedValue(ok(true));
  api.openMcpInstallLink.mockResolvedValue(ok(true));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  useAgentStatesStore.setState({ states: {}, errors: {} });
});

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 10))));

const show = async (ui: ReactNode) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="root"></div>`;
  root = createRoot(document.getElementById("root")!);
  await act(async () => root!.render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>));
  // Main's answer: the command, and which agents have it.
  await settle();
  return document.body;
};

const click = async (el: Element | null | undefined) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};
const entry = (page: HTMLElement) => page.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const menu = (page: HTMLElement) => page.querySelector('[role="dialog"]');
const label = (page: HTMLElement, name: string) => page.querySelector(`[aria-label="${name}"]`);
// A row's line after the button that opens it and the agent's mark: its
// name, then what its right end says.
const rows = (within: Element) =>
  [...within.querySelectorAll("li")].map((li) =>
    [...li.firstElementChild!.children].slice(2).map((part) => part.textContent).join(""),
  );
const row = (within: Element, name: string) =>
  [...within.querySelectorAll("li")].find((li) => li.textContent!.includes(name))!;

it("opens the agents under the titlebar's button, and closes on Escape or a click outside", async () => {
  const page = await show(<McpSetup />);
  expect(entry(page).textContent).toBe("Set up MCP server");
  expect(menu(page)).toBeNull();

  await click(entry(page));
  expect(entry(page).getAttribute("aria-expanded")).toBe("true");
  expect(menu(page)?.getAttribute("aria-label")).toBe("Set up MCP server");
  // Every agent but "Other agent" has an "Add".
  expect(rows(menu(page)!)).toEqual(AGENTS.map((a) => (a.id === "other" ? a.name : `${a.name}Add`)));

  await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(menu(page)).toBeNull();

  await click(entry(page));
  await click(page.querySelector(".fixed.inset-0"));
  expect(menu(page)).toBeNull();
});

it("adds the server to an agent in a click, then waits for its next session", async () => {
  let added: (value: unknown) => void = () => {};
  api.addMcpToAgent.mockReturnValue(new Promise((resolve) => (added = resolve)));
  const page = await show(<McpSetup />);
  await click(entry(page));

  await click(label(page, "Add to Codex"));
  expect(api.addMcpToAgent.mock.calls).toEqual([["codex"]]);
  expect(rows(menu(page)!)[1]).toBe("CodexAdding…");
  expect((label(page, "Add to Codex") as HTMLButtonElement).disabled).toBe(true);

  const reads = api.getMcpSetup.mock.calls.length;
  await act(async () => added(ok(true)));
  await settle();
  expect(rows(menu(page)!)[1]).toBe("CodexStart a new session");
  // The configs are read again, and the menu, closed and opened, still says so.
  expect(api.getMcpSetup).toHaveBeenCalledTimes(reads + 1);
  await click(entry(page));
  await click(entry(page));
  expect(rows(menu(page)!)[1]).toBe("CodexStart a new session");
});

it("opens the row on why a config wasn't changed, over the steps to do it by hand", async () => {
  api.addMcpToAgent.mockResolvedValue(
    err({ status: 409, code: "CONFIG_NOT_CHANGED", message: "config.toml wasn't changed: it isn't TOML." }),
  );
  const page = await show(<McpSetup />);
  await click(entry(page));
  await click(label(page, "Add to Codex"));

  const codex = row(menu(page)!, "Codex");
  expect(rows(menu(page)!)[1]).toBe("CodexAdd");
  expect(label(page, "Codex: set it up manually")?.getAttribute("aria-expanded")).toBe("true");
  expect(codex.querySelector('[role="alert"]')?.textContent).toBe("config.toml wasn't changed: it isn't TOML.");
  expect(codex.querySelector("code")?.textContent).toBe("codex mcp add antidraw -- ~/.antidraw/bin/antidraw mcp");

  // A second try that works takes the reason away.
  api.addMcpToAgent.mockResolvedValue(ok(true));
  await click(label(page, "Add to Codex"));
  expect(codex.querySelector('[role="alert"]')).toBeNull();
});

it("marks an agent as waiting for a new session once its manual step is copied", async () => {
  const page = await show(<McpSetup />);
  await click(entry(page));
  await click(label(page, "Claude Code: set it up manually"));
  expect(menu(page)!.querySelector("code")?.textContent).toBe(
    "claude mcp add --scope user antidraw -- ~/.antidraw/bin/antidraw mcp",
  );

  await click(menu(page)!.querySelector("li")!.querySelector('[aria-label="Copy"]'));
  expect(rows(menu(page)!)[0]).toBe("Claude CodeStart a new session");
  expect(useAgentStatesStore.getState().states).toEqual({ claude: "waiting" });
  expect(entry(page).textContent).toBe("Set up MCP server");
  // The button's dot: something is on its way.
  expect(entry(page).querySelector("span")).not.toBeNull();
});

it("shows each config's own JSON with the command's full path, and opens the agent's install prompt", async () => {
  const page = await show(<TwoWaysRows />);
  await click(label(page, "VS Code: set it up manually"));
  const vscode = row(page, "VS Code");
  expect(vscode.querySelector("pre")?.textContent).toBe(`{
  "servers": {
    "antidraw": {
      "type": "stdio",
      "command": "/Users/me/.antidraw/bin/antidraw",
      "args": ["mcp"]
    }
  }
}`);

  await click([...vscode.querySelectorAll("button")].find((b) => b.textContent === "Or install it from VS Code"));
  expect(api.openMcpInstallLink.mock.calls).toEqual([["vscode"]]);
  expect(rows(page)[3]).toBe("VS CodeVS Code's user mcp.jsonStart a new session");

  // One that couldn't be opened says so, and waits for nothing.
  api.openMcpInstallLink.mockResolvedValue(err({ status: 500, code: "OPEN_FAILED", message: "Couldn't open the agent." }));
  await click(label(page, "Cursor: set it up manually"));
  const cursor = row(page, "Cursor");
  expect(cursor.querySelector("pre")?.textContent).toContain(`"mcpServers"`);
  await click([...cursor.querySelectorAll("button")].find((b) => b.textContent === "Or install it from Cursor"));
  expect(cursor.querySelector('[role="alert"]')?.textContent).toBe("Couldn't open the agent.");
  expect(rows(page)[2]).toBe("Cursor~/.cursor/mcp.jsonAdd");
});

it("names the connected agents on the titlebar's button", async () => {
  const page = await show(<McpSetup />);
  await act(async () => useAgentStatesStore.getState().set("codex", "connected"));
  expect(entry(page).textContent).toBe("Codex connected");
  await act(async () => useAgentStatesStore.getState().set("cursor", "connected"));
  expect(entry(page).textContent).toBe("2 agents connected");
});

it("shows what the agents' configs already have, and this session's states over it", async () => {
  api.getMcpSetup.mockResolvedValue(ok(setup(["claude", "codex", "pi"])));
  useAgentStatesStore.setState({ states: { codex: "waiting", cursor: "adding", vscode: "connected" } });
  const page = await show(<TwoWaysRows />);
  expect(rows(page)).toEqual([
    "Claude Code~/.claude.jsonAdded",
    "Codex~/.codex/config.tomlStart a new session",
    "Cursor~/.cursor/mcp.jsonAdding…",
    "VS CodeVS Code's user mcp.jsonConnected",
    "opencode~/.config/opencode/opencode.jsonAdd",
    "pi~/.pi/agent/mcp.jsonAdded",
    "Other agentAny agent that supports MCP",
  ]);
});

// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpSetup as Setup } from "@/shared/mcp-agents";

// The MCP setup at its two sizes: the titlebar's button and popover, and the
// onboarding page's rows, with main's API faked. A row says what the agent's
// config holds, as main reads it, and how the app's own "Add" went.

const api = vi.hoisted(() => ({
  getMcpSetup: vi.fn(),
  addMcpToAgent: vi.fn(),
  openMcpInstallLink: vi.fn(),
}));
vi.mock("@/renderer/lib/api", () => api);
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/renderer/lib/analytics", () => analytics);

const { McpSetup } = await import("@/renderer/components/McpSetup");
const { useAgentStatesStore } = await import("../agent-states");
const { AGENTS } = await import("../agents");
const { TwoWaysRows } = await import("../TwoWaysRows");
const { OnboardingTwoWays } = await import("../OnboardingTwoWays");

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
  analytics.track.mockReset();
  api.getMcpSetup.mockResolvedValue(ok(setup()));
  api.addMcpToAgent.mockResolvedValue(ok(true));
  api.openMcpInstallLink.mockResolvedValue(ok(true));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  useAgentStatesStore.setState({ adding: {}, errors: {} });
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
const popover = (page: HTMLElement) => page.querySelector('[role="dialog"]');
const label = (page: HTMLElement, name: string) => page.querySelector(`[aria-label="${name}"]`);
// A row's line after the button that opens it and the agent's mark: its
// name and config, then what its right end says.
const rows = (within: Element) =>
  [...within.querySelectorAll("li")].map((li) =>
    [...li.firstElementChild!.children].slice(2).map((part) => part.textContent).join(""),
  );
const row = (within: Element, name: string) =>
  [...within.querySelectorAll("li")].find((li) => li.textContent!.includes(name))!;
const button = (within: Element, text: string) =>
  [...within.querySelectorAll("button")].find((b) => b.textContent === text);

it("opens the agents under the titlebar's button, and closes on Escape or a click outside", async () => {
  const page = await show(<McpSetup />);
  expect(entry(page).textContent).toBe("Set up MCP server");
  expect(popover(page)).toBeNull();

  await click(entry(page));
  expect(entry(page).getAttribute("aria-expanded")).toBe("true");
  expect(popover(page)?.getAttribute("aria-label")).toBe("Set up MCP server");
  // Every agent but "Other agent" has an "Add".
  expect(rows(popover(page)!)).toEqual(
    AGENTS.map((a) => (a.id === "other" ? `${a.name}Any agent that supports MCP` : `${a.name}${a.config}Add`)),
  );

  // The Escape that closes it is handled: the canvas's own Escape (clearing
  // a selection, closing a comment) skips a handled one.
  const canvasSaw: boolean[] = [];
  const canvas = (e: KeyboardEvent) => void (e.key === "Escape" && canvasSaw.push(e.defaultPrevented));
  window.addEventListener("keydown", canvas);
  await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  window.removeEventListener("keydown", canvas);
  expect(popover(page)).toBeNull();
  expect(canvasSaw).toEqual([true]);

  await click(entry(page));
  expect(popover(page)).not.toBeNull();
  await act(async () => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await settle();
  expect(popover(page)).toBeNull();
});

it("keeps a folded row's controls out of the tab order", async () => {
  const page = await show(<TwoWaysRows />);
  const steps = () => row(page, "Codex").querySelector("[inert]");
  expect(steps()).toBeInstanceOf(HTMLElement);
  expect(steps()!.querySelector('[aria-label="Copy"]')).toBeInstanceOf(HTMLElement);
  await click(label(page, "Codex: set it up manually"));
  expect(steps()).toBeNull();
});

it("adds the server to an agent in a click, and says so once its config has it", async () => {
  let added: (value: unknown) => void = () => {};
  api.addMcpToAgent.mockReturnValue(new Promise((resolve) => (added = resolve)));
  const page = await show(<McpSetup />);
  await click(entry(page));

  await click(label(page, "Add to Codex"));
  expect(api.addMcpToAgent.mock.calls).toEqual([["codex"]]);
  expect(rows(popover(page)!)[1]).toBe("Codex~/.codex/config.tomlAdding…");
  expect((label(page, "Add to Codex") as HTMLButtonElement).disabled).toBe(true);

  // "Added" is what main reads back from the config, not that the click went through.
  api.getMcpSetup.mockResolvedValue(ok(setup(["codex"])));
  await act(async () => added(ok(true)));
  await settle();
  expect(rows(popover(page)!)[1]).toBe("Codex~/.codex/config.tomlAdded");

  // The popover, closed and opened, still says so.
  await click(entry(page));
  await click(entry(page));
  expect(rows(popover(page)!)[1]).toBe("Codex~/.codex/config.tomlAdded");
});

it("says an Add failed, and opens the row on why, over the steps to do it by hand", async () => {
  api.addMcpToAgent.mockResolvedValue(
    err({ status: 409, code: "CONFIG_NOT_CHANGED", message: "config.toml wasn't changed: it isn't TOML." }),
  );
  const page = await show(<McpSetup />);
  await click(entry(page));
  await click(label(page, "Add to Codex"));

  const codex = row(popover(page)!, "Codex");
  expect(rows(popover(page)!)[1]).toBe("Codex~/.codex/config.tomlFailed");
  expect(label(page, "Codex: set it up manually")?.getAttribute("aria-expanded")).toBe("true");
  expect(codex.querySelector('[role="alert"]')?.textContent).toBe("config.toml wasn't changed: it isn't TOML. Try again");
  expect(codex.querySelector("code")?.textContent).toBe("codex mcp add antidraw -- ~/.antidraw/bin/antidraw mcp");

  // Trying again, once the config is put right, adds it.
  api.addMcpToAgent.mockResolvedValue(ok(true));
  api.getMcpSetup.mockResolvedValue(ok(setup(["codex"])));
  await click(button(codex, "Try again"));
  expect(api.addMcpToAgent.mock.calls).toEqual([["codex"], ["codex"]]);
  expect(rows(popover(page)!)[1]).toBe("Codex~/.codex/config.tomlAdded");
  expect(codex.querySelector('[role="alert"]')).toBeNull();
});

it("says an agent set up by hand is added once its config has the server", async () => {
  const page = await show(<McpSetup />);
  await click(entry(page));
  await click(label(page, "Claude Code: set it up manually"));
  expect(popover(page)!.querySelector("code")?.textContent).toBe(
    "claude mcp add --scope user antidraw -- ~/.antidraw/bin/antidraw mcp",
  );

  // Copying the command says nothing about the agent: it hasn't been run.
  await click(popover(page)!.querySelector("li")!.querySelector('[aria-label="Copy"]'));
  expect(rows(popover(page)!)[0]).toBe("Claude Code~/.claude.jsonAdd");

  // Run in a terminal: coming back to the window reads the configs again.
  api.getMcpSetup.mockResolvedValue(ok(setup(["claude"])));
  await act(async () => void window.dispatchEvent(new Event("focus")));
  await settle();
  expect(rows(popover(page)!)[0]).toBe("Claude Code~/.claude.jsonAdded");
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

  // The user's mcp.json, which "Add" writes and reads back, not a project's.
  expect([...vscode.querySelectorAll("p")].map((p) => p.textContent)).toContain(
    "Add it to VS Code's user mcp.json (MCP: Open User Configuration):",
  );
  expect(vscode.querySelector("pre")?.previousElementSibling?.textContent).toBe("mcp.json");

  await click(button(vscode, "Or install it from VS Code"));
  expect(api.openMcpInstallLink.mock.calls).toEqual([["vscode"]]);
  expect(vscode.querySelector('[role="alert"]')).toBeNull();

  // A prompt that couldn't be opened says so beside its link; the Add hasn't failed.
  api.openMcpInstallLink.mockResolvedValue(err({ status: 500, code: "OPEN_FAILED", message: "Couldn't open the agent." }));
  await click(label(page, "Cursor: set it up manually"));
  const cursor = row(page, "Cursor");
  expect(cursor.querySelector("pre")?.textContent).toContain(`"mcpServers"`);
  await click(button(cursor, "Or install it from Cursor"));
  expect(cursor.querySelector('[role="alert"]')?.textContent).toBe("Couldn't open the agent.");
  expect(rows(page)[2]).toBe("Cursor~/.cursor/mcp.jsonAdd");
});

it("shows what the agents' configs have, over how an earlier Add went", async () => {
  api.getMcpSetup.mockResolvedValue(ok(setup(["claude", "codex", "pi"])));
  useAgentStatesStore.setState({
    adding: { cursor: true },
    // Codex's was added by hand since; VS Code's is still as it was.
    errors: { codex: "config.toml wasn't changed.", vscode: "mcp.json wasn't changed." },
  });
  const page = await show(<TwoWaysRows />);
  expect(rows(page)).toEqual([
    "Claude Code~/.claude.jsonAdded",
    "Codex~/.codex/config.tomlAdded",
    "Cursor~/.cursor/mcp.jsonAdding…",
    "VS CodeVS Code's user mcp.jsonFailed",
    "opencode~/.config/opencode/opencode.jsonAdd",
    "pi~/.pi/agent/mcp.jsonAdded",
    "Other agentAny agent that supports MCP",
  ]);
  expect(row(page, "Codex").querySelector('[role="alert"]')).toBeNull();
  expect(row(page, "VS Code").querySelector('[role="alert"]')?.textContent).toBe("mcp.json wasn't changed. Try again");
});

it("gives any other agent the command's full path, as its server settings and config take it", async () => {
  const page = await show(<TwoWaysRows />);
  await click(label(page, "Other agent: set it up manually"));
  const other = row(page, "Other agent");
  expect(other.querySelector("code")?.textContent).toBe(`${BRIDGE} mcp`);
  await click(button(other, "Config"));
  expect(other.querySelector("pre")?.textContent).toContain(`"command": "${BRIDGE}"`);
  await click(button(other, "Prompt"));
  expect(other.querySelector("pre")?.textContent).toContain(`runs \`${BRIDGE} mcp\` over stdio`);
});

// What analytics hears: where the setup was shown, which agent, and what was
// done. Never a config's path, the command, or why a config wasn't changed.
it("counts the setup by where it's shown, each agent's Add, and leaving onboarding with what was added", async () => {
  const events = () => analytics.track.mock.calls.map(([event, props]) => [event, props]);
  // Everything heard, across the resets between the test's parts.
  const heard: unknown[] = [];
  const reset = () => {
    heard.push(...events());
    analytics.track.mockReset();
  };

  let page = await show(<McpSetup />);
  expect(events()).toEqual([]);
  await click(entry(page));
  expect(events()).toEqual([["mcp_setup_viewed", { source: "titlebar" }]]);

  // A failed Add opens the row to its manual steps, and that counts as opening
  // them; the command copied there is the titlebar's.
  reset();
  api.addMcpToAgent.mockResolvedValue(err({ status: 409, code: "CONFIG_NOT_CHANGED", message: "config.toml wasn't changed: /Users/me/.codex is locked." }));
  await click(label(page, "Add to Codex"));
  await click(row(page, "Codex").querySelector('[aria-label="Copy"]'));
  // Trying again in the open row doesn't open it again.
  await click(button(row(page, "Codex"), "Try again"));
  expect(events()).toEqual([
    ["mcp_agent_added", { source: "titlebar", agent: "codex", ok: false, error_code: "CONFIG_NOT_CHANGED" }],
    ["mcp_manual_steps_opened", { source: "titlebar", agent: "codex" }],
    ["mcp_setup_copied", { source: "titlebar", agent: "codex", what: "command" }],
    ["mcp_agent_added", { source: "titlebar", agent: "codex", ok: false, error_code: "CONFIG_NOT_CHANGED" }],
  ]);

  // An install prompt that couldn't be opened sends its code, not its message.
  reset();
  api.openMcpInstallLink.mockResolvedValue(err({ status: 500, code: "OPEN_FAILED", message: "Couldn't open /Users/me/.cursor/mcp.json." }));
  await click(label(page, "Cursor: set it up manually"));
  await click(button(row(page, "Cursor"), "Or install it from Cursor"));
  expect(events()).toEqual([
    ["mcp_manual_steps_opened", { source: "titlebar", agent: "cursor" }],
    ["mcp_install_link_opened", { source: "titlebar", agent: "cursor", ok: false, error_code: "OPEN_FAILED" }],
  ]);
  act(() => root?.unmount());

  reset();
  api.openMcpInstallLink.mockResolvedValue(ok(true));
  api.addMcpToAgent.mockResolvedValue(ok(true));
  const opened = vi.fn();
  page = await show(<OnboardingTwoWays onOpenWorkspace={opened} />);
  await click(label(page, "Add to Claude Code"));
  api.getMcpSetup.mockResolvedValue(ok(setup(["claude"])));
  await act(async () => void window.dispatchEvent(new Event("focus")));
  await settle();

  await click(label(page, "VS Code: set it up manually"));
  await click(row(page, "VS Code").querySelector('[aria-label="Copy"]'));
  await click(button(row(page, "VS Code"), "Or install it from VS Code"));
  // Closing a row isn't opening one.
  await click(label(page, "VS Code: set it up manually"));
  await click(label(page, "Other agent: set it up manually"));
  await click(button(row(page, "Other agent"), "Prompt"));
  await click(row(page, "Other agent").querySelector('[aria-label="Copy"]'));
  await click(button(page, "Open workspace"));

  expect(events()).toEqual([
    ["mcp_setup_viewed", { source: "onboarding" }],
    ["mcp_agent_added", { source: "onboarding", agent: "claude", ok: true, error_code: null }],
    ["mcp_manual_steps_opened", { source: "onboarding", agent: "vscode" }],
    ["mcp_setup_copied", { source: "onboarding", agent: "vscode", what: "config" }],
    ["mcp_install_link_opened", { source: "onboarding", agent: "vscode", ok: true, error_code: null }],
    ["mcp_manual_steps_opened", { source: "onboarding", agent: "other" }],
    ["mcp_setup_copied", { source: "onboarding", agent: "other", what: "prompt" }],
    ["onboarding_two_ways_continued", { agents_added: ["claude"], agents_added_count: 1 }],
  ]);
  expect(opened).toHaveBeenCalledOnce();
  expect(JSON.stringify([...heard, ...events()])).not.toMatch(/Users|antidraw|locked|couldn't|mcp\.json/i);
});

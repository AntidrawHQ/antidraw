// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok } from "neverthrow";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// The window's two tabs and the dashboard in jsdom, with main's API faked:
// what the window opens on, what the list shows, and what opening, closing
// and deleting a workspace do to the tab, its dev server and what's saved.

const api = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  getWorkspaceThumbnail: vi.fn(),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  getDevServerStatus: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}));
vi.mock("@/renderer/lib/api", () => api);
// The titlebar's own, each with a test of its own.
vi.mock("@/renderer/components/McpSetup", () => ({ McpSetup: () => <span>MCP</span> }));
vi.mock("@/renderer/components/PublishButton", () => ({ PublishButton: () => <span>Publish</span> }));
vi.mock("@/renderer/hooks/use-update-prompt", () => ({
  useUpdatePrompt: () => ({ pendingVersion: null, showReminder: false }),
}));

// The list shows when each was made as a date, and how long ago: both are
// pinned to one day, or the snapshots below would hold only on the day they
// were written. Date only; timers run as they do.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 10, 23, 12));
afterAll(() => vi.useRealTimers());

const DAY = 86_400_000;
const workspace = (id: string, name: string, madeDaysAgo: number, activeDaysAgo: number) => ({
  id,
  name,
  createdBy: null,
  siteId: null,
  siteUrl: null,
  createdAt: new Date(Date.now() - madeDaysAgo * DAY).toISOString(),
  updatedAt: new Date(Date.now() - madeDaysAgo * DAY).toISOString(),
  thumbnailVersion: null,
  lastActiveAt: Date.now() - activeDaysAgo * DAY,
});
// As main lists them: newest made first.
const WORKSPACES = [
  workspace("w-shaders", "Paper Shaders", 1, 1),
  workspace("w-website", "Antidraw Website", 20, 0.1),
  workspace("w-videos", "Twitter Videos", 40, 9),
];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let root: Root | undefined;
let listed = WORKSPACES;
beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  listed = WORKSPACES;
  api.listWorkspaces.mockImplementation(async () => ok(listed));
  api.deleteWorkspace.mockImplementation(async (id: string) => {
    listed = listed.filter((w) => w.id !== id);
    return ok({ deleted: true });
  });
  api.stopDevServer.mockResolvedValue(ok({ stopped: true }));
  api.setPreference.mockResolvedValue(ok(true));
});
afterEach(async () => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  const { useWorkspaceStore } = await import("@/renderer/store/workspace");
  useWorkspaceStore.setState({ activeWorkspaceId: null, dashboardShown: false });
  // The list's sort is kept while the window is open.
  const { useDashboardStore } = await import("../Dashboard");
  useDashboardStore.setState({ sort: "active" });
});

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));

/** The window as it launches with `saved` as the last activeWorkspaceId (null: never saved). */
const launch = async (saved: string | null) => {
  api.getPreference.mockResolvedValue(ok(saved));
  const { Titlebar } = await import("@/renderer/components/titlebar");
  const { Dashboard } = await import("../Dashboard");
  const { useAutoSelectWorkspace } = await import("@/renderer/lib/workspace-ops");
  const { useWorkspaceStore } = await import("@/renderer/store/workspace");
  // App.tsx's part in it, without the workspace view.
  const Window = () => {
    useAutoSelectWorkspace();
    const dashboardShown = useWorkspaceStore((s) => s.dashboardShown);
    return (
      <>
        <Titlebar />
        {dashboardShown && <Dashboard />}
      </>
    );
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Window />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return useWorkspaceStore;
};

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const tabs = () =>
  [...document.querySelectorAll('[role="tab"]')].map(
    (tab) => `${tab.getAttribute("aria-selected") === "true" ? "●" : "○"} ${text(tab)}`,
  );
const rows = () => [...document.querySelectorAll('main [role="button"]')];
const names = () => rows().map((row) => text(row.querySelector(".truncate")));
const row = (name: string) => rows().find((r) => text(r.querySelector(".truncate")) === name)!;
const button = (name: RegExp) =>
  [...document.querySelectorAll("button")].find((b) => name.test(text(b) ?? "") || name.test(b.getAttribute("aria-label") ?? ""))!;
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};
const fire = async (el: Element, type: string) => {
  await act(async () => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
  await settle();
};
const type = async (value: string) => {
  const input = document.querySelector("main input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
/** What the tab strip shows, whether the dashboard is up, and the workspace's own controls. */
const screen = () => ({
  tabs: tabs(),
  dashboard: !!document.querySelector("main"),
  workspaceControls: !!document.querySelector('[role="tablist"] ~ div div:not(.hidden) > span'),
});
const saved = () => api.setPreference.mock.calls.map(([key, value]) => `${key}=${JSON.stringify(value)}`);

it("opens on the workspace it had open last, on the dashboard if its tab was closed, and on the newest the first time", async () => {
  const opened: Record<string, unknown> = {};
  for (const [label, last] of [
    ["had Twitter Videos open", "w-videos"],
    ["closed its tab", ""],
    ["first launch", null],
    ["its workspace is gone", "w-deleted"],
  ] as const) {
    await launch(last);
    opened[label] = { ...screen(), saved: saved() };
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const { useWorkspaceStore } = await import("@/renderer/store/workspace");
    useWorkspaceStore.setState({ activeWorkspaceId: null, dashboardShown: false });
    api.setPreference.mockClear();
  }
  expect(opened).toMatchInlineSnapshot(`
    {
      "closed its tab": {
        "dashboard": true,
        "saved": [],
        "tabs": [
          "● Dashboard",
        ],
        "workspaceControls": false,
      },
      "first launch": {
        "dashboard": false,
        "saved": [
          "activeWorkspaceId="w-shaders"",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "workspaceControls": true,
      },
      "had Twitter Videos open": {
        "dashboard": false,
        "saved": [],
        "tabs": [
          "○ Dashboard",
          "● Twitter Videos",
        ],
        "workspaceControls": true,
      },
      "its workspace is gone": {
        "dashboard": false,
        "saved": [
          "activeWorkspaceId="w-shaders"",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "workspaceControls": true,
      },
    }
  `);
});

it("lists the workspaces by last active, and by search, name and date made", async () => {
  await launch("");
  const byActive = rows().map((r) => text(r));
  await click(button(/^Last active$/));
  await click(button(/^Name$/));
  const byName = names();
  await click(button(/^Name$/));
  await click(button(/^Date created$/));
  const byCreated = names();
  await type("  ANTI ");
  const searched = names();
  await type("nope");
  const none = text(document.querySelector("main .py-24"));
  expect({ header: text(document.querySelector('main [aria-pressed="true"]')), byActive, byName, byCreated, searched, none })
    .toMatchInlineSnapshot(`
      {
        "byActive": [
          "Antidraw Website2 hours agoNov 3",
          "Paper Shaders1 day agoNov 22",
          "Twitter Videos9 days agoOct 14",
        ],
        "byCreated": [
          "Paper Shaders",
          "Antidraw Website",
          "Twitter Videos",
        ],
        "byName": [
          "Antidraw Website",
          "Paper Shaders",
          "Twitter Videos",
        ],
        "header": "Local3",
        "none": "Nothing matches “nope”.",
        "searched": [
          "Antidraw Website",
        ],
      }
    `);
});

it("opens a workspace in the one tab on a double click, in place of the one there, and goes between it and the dashboard", async () => {
  const store = await launch("w-videos");
  const steps: Record<string, unknown> = { launched: screen() };

  await click(document.querySelectorAll('[role="tab"]')[0]!);
  steps["Dashboard tab"] = { ...screen(), open: store.getState().activeWorkspaceId };

  await click(row("Paper Shaders"));
  steps["a click selects"] = { ...screen(), selected: row("Paper Shaders").className.includes("ring-1") };

  await fire(row("Paper Shaders"), "dblclick");
  steps["a double click opens"] = {
    ...screen(),
    open: store.getState().activeWorkspaceId,
    stopped: api.stopDevServer.mock.calls.flat(),
    saved: saved(),
  };

  await click(document.querySelectorAll('[role="tab"]')[0]!);
  await fire(row("Paper Shaders"), "dblclick");
  steps["opening the one already open goes back to it"] = { ...screen(), stopped: api.stopDevServer.mock.calls.flat() };

  expect(steps).toMatchInlineSnapshot(`
    {
      "Dashboard tab": {
        "dashboard": true,
        "open": "w-videos",
        "tabs": [
          "● Dashboard",
          "○ Twitter Videos",
        ],
        "workspaceControls": false,
      },
      "a click selects": {
        "dashboard": true,
        "selected": true,
        "tabs": [
          "● Dashboard",
          "○ Twitter Videos",
        ],
        "workspaceControls": false,
      },
      "a double click opens": {
        "dashboard": false,
        "open": "w-shaders",
        "saved": [
          "activeWorkspaceId="w-shaders"",
        ],
        "stopped": [
          "w-videos",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "workspaceControls": true,
      },
      "launched": {
        "dashboard": false,
        "tabs": [
          "○ Dashboard",
          "● Twitter Videos",
        ],
        "workspaceControls": true,
      },
      "opening the one already open goes back to it": {
        "dashboard": false,
        "stopped": [
          "w-videos",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "workspaceControls": true,
      },
    }
  `);
});

it("closes the tab onto the dashboard, stopping its dev server", async () => {
  const store = await launch("w-videos");
  await click(button(/^Close tab$/));
  expect({
    ...screen(),
    open: store.getState().activeWorkspaceId,
    stopped: api.stopDevServer.mock.calls.flat(),
    saved: saved(),
  }).toMatchInlineSnapshot(`
    {
      "dashboard": true,
      "open": null,
      "saved": [
        "activeWorkspaceId=""",
      ],
      "stopped": [
        "w-videos",
      ],
      "tabs": [
        "● Dashboard",
      ],
      "workspaceControls": false,
    }
  `);
});

it("deletes a workspace from its menu once confirmed, closing its tab first if it's the one open", async () => {
  const store = await launch("w-videos");
  await click(document.querySelectorAll('[role="tab"]')[0]!);
  const steps: Record<string, unknown> = {};

  await fire(row("Paper Shaders"), "contextmenu");
  steps.menu = [...document.querySelectorAll("main .fixed button")].map((b) => text(b));
  await click(button(/^Delete$/));
  const dialog = () => document.querySelector('[role="dialog"]');
  steps.asked = [text(dialog()?.querySelector("h2")), text(dialog()?.querySelector("p"))];
  await click(button(/^Cancel$/));
  steps.cancelled = { dialog: !!dialog(), deleted: api.deleteWorkspace.mock.calls.flat(), names: names() };

  await fire(row("Paper Shaders"), "contextmenu");
  await click(button(/^Delete$/));
  await click([...dialog()!.querySelectorAll("button")].find((b) => text(b) === "Delete")!);
  steps["another workspace"] = {
    dialog: !!dialog(),
    deleted: api.deleteWorkspace.mock.calls.flat(),
    names: names(),
    tabs: tabs(),
    stopped: api.stopDevServer.mock.calls.flat(),
  };

  await click(row("Twitter Videos").querySelector('[aria-label="More"]')!);
  await click(button(/^Delete$/));
  await click([...dialog()!.querySelectorAll("button")].find((b) => text(b) === "Delete")!);
  steps["the open one"] = {
    deleted: api.deleteWorkspace.mock.calls.flat(),
    names: names(),
    tabs: tabs(),
    open: store.getState().activeWorkspaceId,
    stopped: api.stopDevServer.mock.calls.flat(),
  };

  expect(steps).toMatchInlineSnapshot(`
    {
      "another workspace": {
        "deleted": [
          "w-shaders",
        ],
        "dialog": false,
        "names": [
          "Antidraw Website",
          "Twitter Videos",
        ],
        "stopped": [],
        "tabs": [
          "● Dashboard",
          "○ Twitter Videos",
        ],
      },
      "asked": [
        "Delete “Paper Shaders”?",
        "Its components and chats are removed from this Mac. This can't be undone.",
      ],
      "cancelled": {
        "deleted": [],
        "dialog": false,
        "names": [
          "Antidraw Website",
          "Paper Shaders",
          "Twitter Videos",
        ],
      },
      "menu": [
        "Open",
        "Delete",
      ],
      "the open one": {
        "deleted": [
          "w-shaders",
          "w-videos",
        ],
        "names": [
          "Antidraw Website",
        ],
        "open": null,
        "stopped": [
          "w-videos",
        ],
        "tabs": [
          "● Dashboard",
        ],
      },
    }
  `);
});

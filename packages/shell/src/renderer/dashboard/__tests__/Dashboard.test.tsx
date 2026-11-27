// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { err, ok } from "neverthrow";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// The window's two tabs and the dashboard in jsdom, with main's API faked:
// what the window opens on, what the lists show, and what opening, closing
// and deleting a workspace, or opening or forking a published site, do to the
// tab, its dev server and what's saved.

const api = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  forkSite: vi.fn(),
  deleteWorkspace: vi.fn(),
  getWorkspaceThumbnail: vi.fn(),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  getDevServerStatus: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
  getAccount: vi.fn(),
  getFeatures: vi.fn(),
  getPublishedSites: vi.fn(),
  signIn: vi.fn(),
  cancelSignIn: vi.fn(),
  signOut: vi.fn(),
  publishWorkspace: vi.fn(),
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

const HOUR = 3_600_000;
// As the server lists them: the latest published first.
const SITES = [
  {
    id: "s-shaders",
    slug: "paper-shaders",
    title: "Paper Shaders",
    url: "https://antidraw.com/s/paper-shaders",
    filesUrl: "https://paper-shaders.antidraw.app",
    version: 5,
    publishedAt: Date.now() - 2 * HOUR,
    forkable: true,
  },
  {
    id: "s-pricing",
    slug: "pricing-page",
    title: "Pricing page",
    url: "https://antidraw.com/s/pricing-page",
    filesUrl: "https://pricing-page.antidraw.app",
    version: 1,
    publishedAt: Date.now() - 3 * DAY,
    // Published before a version's source was kept.
    forkable: false,
  },
];
const ACCOUNT = { id: "u1", name: "Ada Lovelace", email: "ada@example.com", image: null };
const SIGNED_OUT = { status: 401, code: "SIGNED_OUT", message: "Not signed in" };

// The sites' canvas.json, by URL; a URL without one is a 404.
const canvasFiles: Record<string, unknown> = {
  "https://paper-shaders.antidraw.app/canvas.json": {
    version: 1,
    name: "Paper Shaders",
    components: [{ name: "Hero" }, { name: "Price Card" }],
    layouts: [{ componentName: "Hero", x: 0, y: 0, width: 640, height: 400 }],
  },
};
const fetched: string[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // What jsdom lacks and the viewer's canvas (React Flow) reads.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class {
    m22 = 1;
  };
  // The renderer's own fetch: only the viewer's, for a site's canvas.json.
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    const file = canvasFiles[url];
    return file ? Response.json(file) : new Response(null, { status: 404 });
  });
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
  // Publishing is off, and nobody is signed in, unless a test says so.
  api.getFeatures.mockResolvedValue(ok({ publish: false }));
  api.getAccount.mockResolvedValue(ok(null));
  api.getPublishedSites.mockResolvedValue(err(SIGNED_OUT));
  api.cancelSignIn.mockResolvedValue(ok(true));
  fetched.length = 0;
});
afterEach(async () => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  const { useWorkspaceStore } = await import("@/renderer/store/workspace");
  useWorkspaceStore.setState({ activeWorkspaceId: null, publishedSite: null, dashboardShown: false });
  // The section and the list's sort are kept while the window is open.
  const { useDashboardStore } = await import("../Dashboard");
  useDashboardStore.setState({ section: "local", sort: "active", view: "list" });
});

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));

/** The window as it launches with `saved` as the last activeWorkspaceId (null: never saved). */
const launch = async (saved: string | null) => {
  api.getPreference.mockResolvedValue(ok(saved));
  const { Titlebar } = await import("@/renderer/components/titlebar");
  const { Dashboard } = await import("../Dashboard");
  const { useAutoSelectWorkspace } = await import("@/renderer/lib/workspace-ops");
  const { useWorkspaceStore } = await import("@/renderer/store/workspace");
  const { PublishedViewer } = await import("@/renderer/published/PublishedViewer");
  // App.tsx's part in it, without the workspace view.
  const Window = () => {
    useAutoSelectWorkspace();
    const dashboardShown = useWorkspaceStore((s) => s.dashboardShown);
    const publishedSite = useWorkspaceStore((s) => s.publishedSite);
    return (
      <>
        <Titlebar />
        {publishedSite && (
          <div id="viewer" style={{ width: 1200, height: 800 }}>
            <PublishedViewer site={publishedSite} />
          </div>
        )}
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
// The window's tabs: the titlebar's, not the dashboard's sections under it.
const tabs = () =>
  [...document.querySelector('[role="tablist"]')!.querySelectorAll('[role="tab"]')].map(
    (tab) => `${tab.getAttribute("aria-selected") === "true" ? "●" : "○"} ${text(tab)}`,
  );
// The lists' rows, without their headings' row.
const rows = () => [...document.querySelectorAll('main [role="row"][tabindex]')];
const names = () => rows().map((row) => text(row.querySelector(".truncate")));
const row = (name: string) => rows().find((r) => text(r.querySelector(".truncate")) === name)!;
// A button, or a menu's item, by what it says.
const button = (name: RegExp) =>
  [...document.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"]')].find(
    (b) => name.test(text(b) ?? "") || name.test(b.getAttribute("aria-label") ?? ""),
  )!;
// A whole press, not only its click: Radix opens a menu as the pointer goes
// down on its button, and picks a tab as the mouse does.
const click = async (el: Element) => {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    (el as HTMLElement).click();
  });
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
  // A workspace's (MCP setup, Publish), not a published site's in its place.
  workspaceControls: [...document.querySelectorAll('[role="tablist"] ~ div div:not(.hidden) > span')].some(
    (el) => !el.closest(".contents"),
  ),
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
  expect({ header: text(document.querySelector('main [role="tab"][aria-selected="true"]')), byActive, byName, byCreated, searched, none })
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

// A key, to whatever has the focus.
const key = async (name: string, init: KeyboardEventInit = {}) => {
  await act(
    async () =>
      void document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
      ),
  );
  await settle();
};
// What has the focus: a row by its name, anything else by its role and what it says.
const focused = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  if (el.getAttribute("role") === "row") return `row: ${text(el.querySelector(".truncate"))}`;
  const says = text(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder");
  return `${el.getAttribute("role") ?? el.tagName.toLowerCase()}: ${says}`;
};
const selectedRows = () => rows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => text(r.querySelector(".truncate")));
const menu = () =>
  [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].map(
    (item) => `${item.getAttribute("aria-checked") === "true" ? "✓ " : ""}${text(item)}`,
  );

it("is worked from the keyboard: ⌘F and ↓ into the list, the arrows through it and Enter to open; the sections, the sort and a row's menu with the keys alone", async () => {
  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  const store = await launch("");
  const steps: Record<string, unknown> = {};

  // Tab stops at one row of the list and at its ⋯, not at each of them.
  steps["the list's stops for Tab"] = [...document.querySelectorAll('main [role="grid"] [tabindex="0"]')].map(
    (el) => (el.getAttribute("role") === "row" ? `row: ${text(el.querySelector(".truncate"))}` : el.getAttribute("aria-label")),
  );

  await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true })));
  steps["⌘F"] = focused();
  await key("ArrowDown");
  steps["↓ from the search"] = { focused: focused(), selected: selectedRows() };
  await key("ArrowDown");
  steps["↓"] = { focused: focused(), selected: selectedRows() };
  await key("End");
  await key("ArrowDown");
  steps["End, and ↓ at the last"] = focused();
  await key("Home");
  steps["Home"] = focused();

  // The sort: Enter opens its menu on what it's set to; ↓ and Enter pick another.
  (button(/^Last active$/) as HTMLElement).focus();
  await key("Enter");
  steps["Enter on the sort"] = { menu: menu(), focused: focused() };
  await key("ArrowDown");
  await key("ArrowDown");
  await key("Enter");
  steps["↓ ↓ Enter"] = { names: names(), focused: focused(), menu: menu() };

  // The sections: → goes to the next and shows it, ← comes back.
  (section(/^Local/) as HTMLElement).focus();
  await key("ArrowRight");
  steps["→ on Local"] = { sections: sections(), focused: focused(), rows: rows().length };
  await key("ArrowLeft");
  steps["←"] = sections();

  // A row's menu, from its ⋯: Enter opens it, Esc closes it back onto the ⋯.
  (row("Paper Shaders").querySelector('[aria-label="More"]') as HTMLElement).focus();
  await key("Enter");
  steps["Enter on a row's ⋯"] = { menu: menu(), focused: focused() };
  await key("Escape");
  steps["Esc"] = { menu: menu(), focused: focused(), open: store.getState().activeWorkspaceId };
  await key("Enter");
  await key("Enter");
  steps["Enter, Enter"] = { ...screen(), open: store.getState().activeWorkspaceId };

  // And a row itself: Enter opens it.
  await click(document.querySelectorAll('[role="tab"]')[0]!);
  (row("Twitter Videos") as HTMLElement).focus();
  await key("Enter");
  steps["Enter on a row"] = { ...screen(), open: store.getState().activeWorkspaceId };

  expect(steps).toMatchInlineSnapshot(`
    {
      "End, and ↓ at the last": "row: Twitter Videos",
      "Enter on a row": {
        "dashboard": false,
        "open": "w-videos",
        "tabs": [
          "○ Dashboard",
          "● Twitter Videos",
        ],
        "workspaceControls": true,
      },
      "Enter on a row's ⋯": {
        "focused": "menuitem: Open",
        "menu": [
          "Open",
        ],
      },
      "Enter on the sort": {
        "focused": "menuitemradio: Last active",
        "menu": [
          "✓ Last active",
          "Date created",
          "Name",
        ],
      },
      "Enter, Enter": {
        "dashboard": false,
        "open": "w-shaders",
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "workspaceControls": true,
      },
      "Esc": {
        "focused": "button: More",
        "menu": [],
        "open": null,
      },
      "Home": "row: Antidraw Website",
      "the list's stops for Tab": [
        "row: Antidraw Website",
        "More",
      ],
      "←": [
        "● Local3",
        "○ Published2",
      ],
      "→ on Local": {
        "focused": "tab: Published2",
        "rows": 2,
        "sections": [
          "○ Local3",
          "● Published2",
        ],
      },
      "↓": {
        "focused": "row: Paper Shaders",
        "selected": [
          "Paper Shaders",
        ],
      },
      "↓ from the search": {
        "focused": "row: Antidraw Website",
        "selected": [
          "Antidraw Website",
        ],
      },
      "↓ ↓ Enter": {
        "focused": "button: Name",
        "menu": [],
        "names": [
          "Antidraw Website",
          "Paper Shaders",
          "Twitter Videos",
        ],
      },
      "⌘F": "input: Search workspaces",
    }
  `);
});

it("shows the workspaces, and what's published, as cards from the switch at the end of the header's row, and keeps to them", async () => {
  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  const store = await launch("");
  const view = () =>
    [...document.querySelectorAll('main [aria-label="View"] [role="radio"]')].map(
      (item) => `${item.getAttribute("aria-checked") === "true" ? "●" : "○"} ${item.getAttribute("aria-label")}`,
    );
  // Rows have their columns' headings; cards have none.
  const shown = () => ({ view: view(), headings: !!document.querySelector('main [role="columnheader"]'), items: rows().map((r) => text(r)) });
  const steps: Record<string, unknown> = { "as it opens": shown() };

  await click(button(/^Cards$/));
  steps["Cards"] = shown();
  // The keys, as in the list, and to the one beside.
  (rows()[0] as HTMLElement).focus();
  await key("ArrowRight");
  steps["→"] = { focused: focused(), selected: selectedRows() };
  await key("End");
  await key("ArrowLeft");
  steps["End, ←"] = focused();
  await click(section(/^Published/));
  steps["Published"] = shown();

  // Still cards after the dashboard has been away: a card opens a workspace, and the Dashboard tab comes back to them.
  await click(section(/^Local/));
  await fire(row("Twitter Videos"), "dblclick");
  steps["a double click on a card"] = store.getState().activeWorkspaceId;
  await click(document.querySelectorAll('[role="tab"]')[0]!);
  steps["back on the dashboard"] = view();
  await click(button(/^List$/));
  steps["List"] = shown();

  expect(steps).toMatchInlineSnapshot(`
    {
      "Cards": {
        "headings": false,
        "items": [
          "Antidraw Website2 hours ago",
          "Paper Shaders1 day ago",
          "Twitter Videos9 days ago",
        ],
        "view": [
          "● Cards",
          "○ List",
        ],
      },
      "End, ←": "row: Paper Shaders",
      "List": {
        "headings": true,
        "items": [
          "Antidraw Website2 hours agoNov 3",
          "Paper Shaders1 day agoNov 22",
          "Twitter Videos9 days agoOct 14",
        ],
        "view": [
          "○ Cards",
          "● List",
        ],
      },
      "Published": {
        "headings": false,
        "items": [
          "Paper Shadersv5 · 2 hours ago Fork",
          "Pricing pagev1 · 3 days ago Fork",
        ],
        "view": [
          "● Cards",
          "○ List",
        ],
      },
      "a double click on a card": "w-videos",
      "as it opens": {
        "headings": true,
        "items": [
          "Antidraw Website2 hours agoNov 3",
          "Paper Shaders1 day agoNov 22",
          "Twitter Videos9 days agoOct 14",
        ],
        "view": [
          "○ Cards",
          "● List",
        ],
      },
      "back on the dashboard": [
        "● Cards",
        "○ List",
      ],
      "→": {
        "focused": "row: Paper Shaders",
        "selected": [
          "Paper Shaders",
        ],
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

// Delete is held back for now (Dashboard.tsx).
it.skip("deletes a workspace from its menu once confirmed, closing its tab first if it's the one open", async () => {
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

/* ── Published ────────────────────────────────────────────────────────── */

const sections = () => [...document.querySelectorAll('main [role="tab"]')].map((b) => `${b.getAttribute("aria-selected") === "true" ? "●" : "○"} ${text(b)}`);
const section = (name: RegExp) => [...document.querySelectorAll('main [role="tab"]')].find((b) => name.test(text(b) ?? ""))!;
const publishedRows = () => rows().map((r) => [...r.children].map((cell) => text(cell)).filter(Boolean).join(" | "));
/** The line in place of a list, and the buttons under it. */
const notice = () => {
  const el = document.querySelector("main .py-24");
  return el ? [text(el.querySelector("span")), ...[...el.querySelectorAll("button")].map((b) => `[${text(b)}]`)].join(" ") : null;
};
// The site's controls, on the titlebar's right where a workspace has Publish.
const siteBar = () => document.querySelector(".drag-region .contents");
const viewer = () => {
  const el = document.querySelector("#viewer");
  if (!el) return null;
  const bar = siteBar();
  return {
    bar: text(bar),
    frames: [...el.querySelectorAll("iframe")].map((frame) => frame.getAttribute("src")),
    controls: [...(bar?.querySelectorAll("button") ?? []), ...el.querySelectorAll("button")].map(
      (b) => text(b) || b.getAttribute("aria-label") || b.getAttribute("title"),
    ),
  };
};

it("has no Published section where publishing is off, and lists the account's sites where it's on", async () => {
  await launch("");
  const off = { sections: sections(), asked: api.getPublishedSites.mock.calls.length };
  act(() => root?.unmount());

  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  await launch("");
  const local = { sections: sections(), names: names() };
  await click(section(/^Published/));
  const published = { sections: sections(), rows: publishedRows(), search: document.querySelector("main input")?.getAttribute("placeholder") };
  await type("pric");
  const searched = publishedRows();
  await type("zzz");
  const nothing = notice();
  // Back on Local, the search starts over.
  await click(section(/^Local/));
  expect({ off, local, published, searched, nothing, backOnLocal: names() }).toMatchInlineSnapshot(`
    {
      "backOnLocal": [
        "Antidraw Website",
        "Paper Shaders",
        "Twitter Videos",
      ],
      "local": {
        "names": [
          "Antidraw Website",
          "Paper Shaders",
          "Twitter Videos",
        ],
        "sections": [
          "● Local3",
          "○ Published2",
        ],
      },
      "nothing": "Nothing matches “zzz”.",
      "off": {
        "asked": 0,
        "sections": [
          "● Local3",
        ],
      },
      "published": {
        "rows": [
          "Paper Shaders | v5 · 2 hours ago | Fork",
          "Pricing page | v1 · 3 days ago | Fork",
        ],
        "search": "Search published",
        "sections": [
          "○ Local3",
          "● Published2",
        ],
      },
      "searched": [
        "Pricing page | v1 · 3 days ago | Fork",
      ],
    }
  `);
});

it("opens a published site view-only in the one tab, in place of the workspace there, and a workspace in place of it", async () => {
  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  const store = await launch("w-videos");
  const steps: Record<string, unknown> = {};

  await click(document.querySelectorAll('[role="tab"]')[0]!);
  await click(section(/^Published/));
  await click(rows()[0]!);
  steps["a click opens it"] = {
    ...screen(),
    workspace: store.getState().activeWorkspaceId,
    stopped: api.stopDevServer.mock.calls.flat(),
    saved: saved(),
    viewer: viewer(),
    fetched: [...fetched],
  };

  // Copied on the button itself for a moment, as the publish panel's Copy.
  const writeText = vi.fn(async (_: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await click(button(/Copy link/));
  steps["Copy link"] = { copied: writeText.mock.calls.flat(), button: text(button(/^Copied$/)) };
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1500))));
  steps["a moment later"] = text(button(/^Copy link$/));

  // The dashboard comes back on Published, with the site still in its tab.
  await click(document.querySelectorAll('[role="tab"]')[0]!);
  steps["Dashboard tab"] = { ...screen(), sections: sections(), viewerKept: !!viewer() };

  // A site whose canvas.json can't be had.
  await click(rows()[1]!);
  steps["one that can't be loaded"] = { tabs: tabs(), viewer: text(document.querySelector("#viewer .absolute.place-items-center")) };

  await click(document.querySelectorAll('[role="tab"]')[0]!);
  await click(section(/^Local/));
  await fire(row("Paper Shaders"), "dblclick");
  steps["a workspace in its place"] = {
    ...screen(),
    workspace: store.getState().activeWorkspaceId,
    viewer: viewer(),
    saved: saved(),
  };

  await click(document.querySelectorAll('[role="tab"]')[0]!);
  await click(section(/^Published/));
  await click(rows()[0]!);
  await click(button(/^Close tab$/));
  steps["closed"] = { ...screen(), viewer: viewer(), workspace: store.getState().activeWorkspaceId };

  expect(steps).toMatchInlineSnapshot(`
    {
      "Copy link": {
        "button": "Copied",
        "copied": [
          "https://antidraw.com/s/paper-shaders",
        ],
      },
      "Dashboard tab": {
        "dashboard": true,
        "sections": [
          "○ Local3",
          "● Published2",
        ],
        "tabs": [
          "● Dashboard",
          "○ Paper Shaders",
        ],
        "viewerKept": true,
        "workspaceControls": false,
      },
      "a click opens it": {
        "dashboard": false,
        "fetched": [
          "https://paper-shaders.antidraw.app/canvas.json",
        ],
        "saved": [
          "activeWorkspaceId=""",
        ],
        "stopped": [
          "w-videos",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "viewer": {
          "bar": "View only · Published 2 hours agoCopy linkFork",
          "controls": [
            "Copy link",
            "Fork",
          ],
          "frames": [
            "https://paper-shaders.antidraw.app/preview?componentName=Hero",
            "https://paper-shaders.antidraw.app/preview?componentName=Price%20Card",
          ],
        },
        "workspace": null,
        "workspaceControls": false,
      },
      "a moment later": "Copy link",
      "a workspace in its place": {
        "dashboard": false,
        "saved": [
          "activeWorkspaceId=""",
          "activeWorkspaceId="w-shaders"",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
        "viewer": null,
        "workspace": "w-shaders",
        "workspaceControls": true,
      },
      "closed": {
        "dashboard": true,
        "tabs": [
          "● Dashboard",
        ],
        "viewer": null,
        "workspace": null,
        "workspaceControls": false,
      },
      "one that can't be loaded": {
        "tabs": [
          "○ Dashboard",
          "● Pricing page",
        ],
        "viewer": "This canvas could not be loaded.Try again",
      },
    }
  `);
});

it("says why there's no list: signed out, with a way in; an account not let in; a server that can't say, with another try", async () => {
  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  await launch("");
  const steps: Record<string, unknown> = {};
  await click(section(/^Published/));
  steps["signed out"] = { sections: sections(), notice: notice() };

  // The browser has it until the user is done there.
  let finish!: (value: unknown) => void;
  api.signIn.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  await click(button(/^Sign in$/));
  steps["signing in"] = notice();
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok([]));
  await act(async () => finish(ok(ACCOUNT)));
  await settle();
  steps["signed in, nothing published"] = { sections: sections(), notice: notice() };
  act(() => root?.unmount());

  api.getPublishedSites.mockResolvedValue(err({ status: 403, code: "PUBLISH_DISABLED", message: "Publishing isn't available yet." }));
  await launch("");
  await click(section(/^Published/));
  steps["not let in"] = notice();
  act(() => root?.unmount());

  api.getPublishedSites.mockResolvedValue(err({ status: 502, code: "SERVER_UNREACHABLE", message: "Couldn't reach the Antidraw server" }));
  await launch("");
  await click(section(/^Published/));
  steps["unreachable"] = notice();
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  await click(button(/^Try again$/));
  steps["tried again"] = publishedRows();

  expect(steps).toMatchInlineSnapshot(`
    {
      "not let in": "Publishing isn't available yet.",
      "signed in, nothing published": {
        "notice": "Nothing published yet.",
        "sections": [
          "○ Local3",
          "● Published0",
        ],
      },
      "signed out": {
        "notice": "Sign in to see what you've published. [Sign in]",
        "sections": [
          "○ Local3",
          "● Published",
        ],
      },
      "signing in": "Finish signing in in your browser. [Cancel]",
      "tried again": [
        "Paper Shaders | v5 · 2 hours ago | Fork",
        "Pricing page | v1 · 3 days ago | Fork",
      ],
      "unreachable": "Couldn't reach the Antidraw server [Try again]",
    }
  `);
});

it("shows each published site's picture in its tile, and the plain tile for one without", async () => {
  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  await launch("");
  await click(section(/^Published/));
  const pictures = () => rows().map((row) => `${text(row.querySelector(".truncate"))}: ${row.querySelector("img")?.getAttribute("src") ?? "none"}`);
  // Each version's picture has its own address, served with the site's files.
  expect(pictures()).toEqual([
    "Paper Shaders: https://paper-shaders.antidraw.app/og.jpg?v=5",
    "Pricing page: https://pricing-page.antidraw.app/og.jpg?v=1",
  ]);

  // A site published before pictures were taken has none: its tile stays the canvas's grey.
  await act(async () => void rows()[1]!.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(pictures()).toEqual(["Paper Shaders: https://paper-shaders.antidraw.app/og.jpg?v=5", "Pricing page: none"]);

  // As cards too.
  await click(button(/^Cards$/));
  expect(pictures()[0]).toBe("Paper Shaders: https://paper-shaders.antidraw.app/og.jpg?v=5");
});

it("forks a published site from its row or from the viewer, showing how it goes, and the tab becomes the fork", async () => {
  api.getFeatures.mockResolvedValue(ok({ publish: true }));
  api.getAccount.mockResolvedValue(ok(ACCOUNT));
  api.getPublishedSites.mockResolvedValue(ok(SITES));
  const forked = workspace("w-fork", "Paper Shaders (fork)", 0, 0);
  // Main's side of a fork: each step when the test lets it go on.
  let go: Record<string, () => void> = {};
  const until = (step: string) => new Promise<void>((resolve) => (go[step] = resolve));
  let fails = false;
  api.forkSite.mockImplementation(async function* () {
    yield { type: "status", status: "FETCHING_SOURCE" };
    await until("fetched");
    if (fails) {
      yield { type: "error", error: { code: "SOURCE_FAILED", message: "Couldn't fetch the site's source (503). Try again." } };
      return;
    }
    yield { type: "status", status: "INSTALLING_DEPENDENCIES" };
    yield { type: "npm", output: { type: "stdout", data: "npm http fetch GET 200 react\n" } };
    await until("installed");
    yield { type: "status", status: "SAVING_WORKSPACE" };
    listed = [forked, ...WORKSPACES];
    yield { type: "done", workspace: forked };
  });
  const next = async (step: string) => {
    await act(async () => go[step]!());
    await settle();
  };
  const dialog = () => document.querySelector('[role="dialog"]');
  // What the dialog says of the fork: the step it's on, what went wrong, and npm's lines.
  const progress = () => ({
    title: text(dialog()?.querySelector("h2")),
    said: text(dialog()?.querySelector('[role="status"]')),
    failed: text(dialog()?.querySelector('[role="alert"]')),
    log: [...(dialog()?.querySelectorAll(".font-mono") ?? [])].map(text),
  });
  const store = await launch("");
  const steps: Record<string, unknown> = {};

  await click(section(/^Published/));
  const forkOf = (name: string) => button(new RegExp(`^Fork ${name}$`)) as HTMLButtonElement;
  steps["which can be forked"] = SITES.map(({ title }) => `${title}: ${forkOf(title).disabled ? forkOf(title).title : "Fork"}`);
  // One that can't: nothing happens, and its row doesn't open either.
  await click(forkOf("Pricing page"));
  steps["one that can't"] = { forks: api.forkSite.mock.calls.length, dialog: !!dialog(), tabs: tabs() };

  // From its row. The click is the button's: the site isn't opened.
  fails = true;
  await click(forkOf("Paper Shaders"));
  steps["Fork, from the row"] = { asked: api.forkSite.mock.calls.flat(), ...progress(), tabs: tabs() };
  await next("fetched");
  steps["it fails"] = progress();
  fails = false;
  await click(button(/^Try again$/));
  await next("fetched");
  steps["tried again, installing"] = progress();
  await next("installed");
  steps["done"] = progress();
  // It closes a moment after, onto the new workspace.
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 700))));
  await settle();
  steps["the tab is the fork"] = {
    ...screen(),
    dialog: !!dialog(),
    workspace: store.getState().activeWorkspaceId,
    saved: saved(),
  };

  // From the viewer: the fork takes the site's place in the tab.
  await click(document.querySelectorAll('[role="tab"]')[0]!);
  await click(section(/^Published/));
  await click(rows()[0]!);
  steps["in the viewer"] = {
    tabs: tabs(),
    bar: text(siteBar()),
    stopped: api.stopDevServer.mock.calls.flat(),
  };
  // Its progress on a card over the canvas, and Fork held while it runs.
  const card = () => {
    const el = document.querySelector("#viewer .z-\\[70\\]");
    if (!el) return null;
    // Each step with its mark: ✓ done, ● running, ✗ failed, ○ to come.
    const marks = [...el.querySelectorAll(".space-y-2\\.5 > div")].map((step) => {
      const dot = step.querySelector("span")!;
      const mark = dot.className.includes("#86D8A6") ? "✓" : dot.className.includes("#d9605c") ? "✗" : dot.querySelector(".animate-pulse") ? "●" : "○";
      return `${mark} ${text(step)}`;
    });
    return {
      title: text(el.querySelector(".truncate")),
      steps: marks,
      failed: text(el.querySelector('[role="alert"]')),
      dialog: !!dialog(),
      forkHeld: forkOf("Paper Shaders").disabled,
    };
  };
  go = {};
  fails = true;
  await click(forkOf("Paper Shaders"));
  steps["viewer: forking"] = card();
  await next("fetched");
  steps["viewer: it fails"] = card();
  fails = false;
  await click(button(/^Try again$/));
  await next("fetched");
  steps["viewer: installing"] = card();
  await next("installed");
  steps["viewer: done"] = card();
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 700))));
  await settle();
  steps["forked from the viewer"] = {
    ...screen(),
    viewer: !!document.querySelector("#viewer"),
    workspace: store.getState().activeWorkspaceId,
    forks: api.forkSite.mock.calls.flat(),
  };

  expect(steps).toMatchInlineSnapshot(`
    {
      "Fork, from the row": {
        "asked": [
          "s-shaders",
        ],
        "failed": null,
        "log": [],
        "said": "Pulling the source of v5…",
        "tabs": [
          "● Dashboard",
        ],
        "title": "Forking Paper Shaders",
      },
      "done": {
        "failed": null,
        "log": [],
        "said": "Workspace forked",
        "title": "Forking Paper Shaders",
      },
      "forked from the viewer": {
        "dashboard": false,
        "forks": [
          "s-shaders",
          "s-shaders",
          "s-shaders",
          "s-shaders",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders (fork)",
        ],
        "viewer": false,
        "workspace": "w-fork",
        "workspaceControls": true,
      },
      "in the viewer": {
        "bar": "View only · Published 2 hours agoCopy linkFork",
        "stopped": [
          "w-fork",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders",
        ],
      },
      "it fails": {
        "failed": "Couldn't fetch the site's source (503). Try again.",
        "log": [],
        "said": "Pulling the source of v5 failed",
        "title": "Forking Paper Shaders",
      },
      "one that can't": {
        "dialog": false,
        "forks": 0,
        "tabs": [
          "● Dashboard",
        ],
      },
      "the tab is the fork": {
        "dashboard": false,
        "dialog": false,
        "saved": [
          "activeWorkspaceId="w-fork"",
        ],
        "tabs": [
          "○ Dashboard",
          "● Paper Shaders (fork)",
        ],
        "workspace": "w-fork",
        "workspaceControls": true,
      },
      "tried again, installing": {
        "failed": null,
        "log": [
          "npm http fetch GET 200 react",
        ],
        "said": "Installing packages…",
        "title": "Forking Paper Shaders",
      },
      "viewer: done": {
        "dialog": false,
        "failed": null,
        "forkHeld": true,
        "steps": [
          "✓ Pulling the source of v5",
          "✓ Installing packages",
          "✓ Starting the canvas",
        ],
        "title": "Forking Paper Shaders",
      },
      "viewer: forking": {
        "dialog": false,
        "failed": null,
        "forkHeld": true,
        "steps": [
          "● Pulling the source of v5",
          "○ Installing packages",
          "○ Starting the canvas",
        ],
        "title": "Forking Paper Shaders",
      },
      "viewer: installing": {
        "dialog": false,
        "failed": null,
        "forkHeld": true,
        "steps": [
          "✓ Pulling the source of v5",
          "● Installing packages",
          "○ Starting the canvas",
        ],
        "title": "Forking Paper Shaders",
      },
      "viewer: it fails": {
        "dialog": false,
        "failed": "Couldn't fetch the site's source (503). Try again.",
        "forkHeld": true,
        "steps": [
          "✗ Pulling the source of v5",
          "○ Installing packages",
          "○ Starting the canvas",
        ],
        "title": "Forking Paper Shaders",
      },
      "which can be forked": [
        "Paper Shaders: Fork",
        "Pricing page: Publish this site again to fork it",
      ],
    }
  `);
});

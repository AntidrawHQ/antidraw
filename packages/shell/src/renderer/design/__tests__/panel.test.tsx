// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import type { Comment } from "@/main/api";
import type { Style } from "@/shared/design";
import type { EditedElement, EditList } from "@/shared/utils/canvas-edits";
import type { CommentList } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { setCanvasTool, useCommentStore } from "@/renderer/comments/store";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { RightPanel } from "../RightPanel";
import { EditBar } from "../EditBar";
import { useDesignStore } from "../store";

// The right panel and the canvas's edit bar, over what the app's API holds:
// the edits and the comments.

const WS = "8a3c2f00-0000-4000-8000-000000000001";

const info = (loc: string, classes: string[]): ElementInfo => ({
  ref: { loc, index: 0, path: [0], tag: "div" },
  callsite: null,
  tag: "div",
  id: "",
  classes,
  text: "",
  rect: { x: 0, y: 0, width: 300, height: 200 },
  margin: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
});

const base = {
  flow: "column",
  main: "start",
  cross: "start",
  between: false,
  gap: 12,
  wMode: "fixed",
  w: 300,
  hMode: "hug",
  h: 200,
  pt: 24,
  pr: 24,
  pb: 24,
  pl: 24,
  mt: 0,
  mr: 0,
  mb: 0,
  ml: 0,
  hidden: false,
  opacity: 100,
  radius: 16,
  corners: [16, 16, 16, 16],
  fill: "#FFFFFF",
  fillA: 100,
  gradient: false,
  stroke: null,
  shadow: null,
  shadowRest: [],
  weight: "400",
  size: 14,
  lh: 20,
  ls: 0,
  talign: "left",
  color: "#18181B",
  colorA: 100,
  content: null,
} satisfies Style;

const edit = (id: number, loc: string, now: Partial<Style>): EditedElement => ({
  id,
  componentName: "Card",
  element: info(loc, [id === 1 ? "card" : "title"]),
  name: id === 1 ? "div.card" : "div.title",
  text: false,
  base,
  now: { ...base, ...now },
  seen: null,
});

const comment = (id: number, text: string, state: Comment["state"] = "draft"): Comment => ({
  id,
  workspaceId: WS,
  componentName: "Card",
  x: 10,
  y: 10,
  element: null,
  text,
  state,
  note: null,
  conversationId: null,
  createdAt: new Date(),
  sentAt: null,
  completedAt: null,
  clearedAt: null,
});

let root: Root;
let host: HTMLElement;
let client: QueryClient;
let requests: { url: string; method: string }[];

const render = async (edits: EditList, comments: CommentList = { comments: [], chats: [] }) => {
  client.setQueryData(queryKeys.edits.byWorkspace(WS), edits);
  client.setQueryData(queryKeys.comments.byWorkspace(WS), comments);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <EditBar />
        <RightPanel />
      </QueryClientProvider>,
    ),
  );
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // What leaves goes at once.
  MotionGlobalConfig.skipAnimations = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      // The API holds what was written here: a refetch reads it back.
      const body = url.endsWith("/edits") && method === "GET" ? client.getQueryData(queryKeys.edits.byWorkspace(WS)) : method === "PUT" ? null : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  useWorkspaceStore.setState({ activeWorkspaceId: WS, activeConversationId: null });
  useCommentStore.setState({ onCanvas: () => true });
  document.body.innerHTML = `<div id="root"></div>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  setCanvasTool("pointer");
  useInspectorStore.setState({ active: false, frames: {}, selection: null, tags: [], missing: {} });
  useDesignStore.setState({ panelOpen: true, tab: "design", read: null });
  vi.unstubAllGlobals();
  MotionGlobalConfig.skipAnimations = false;
});

const text = () => host.textContent ?? "";
// A click, and what it takes away gone: motion lets it go a frame later.
const press = (label: string) =>
  act(async () => {
    button(label).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.title === label)!;

it("with Inspect on and nothing edited: the bar says so, and Design how to pick", async () => {
  act(() => setCanvasTool("inspect"));
  await render({ edits: [], applied: [] });
  expect(text()).toContain("Precise edits");
  expect(text()).toContain("No changes yet");
  expect(button("Reset").disabled).toBe(true);
  expect(text()).toContain("Select an element");
});

it("counts the changes on their elements, lists them, and Reset undoes them all", async () => {
  await render({ edits: [edit(1, "Card.tsx:3:5", { radius: 24, gap: 16 }), edit(2, "Card.tsx:4:7", { pt: 32 })], applied: [] });
  expect(text()).toContain("3 unsaved changes on 2 elements");
  await press("See the changes");
  expect(text()).toContain("div.card");
  expect(text()).toContain("Corner radius16 → 24");
  await press("Reset");
  expect(text()).not.toContain("unsaved");
  expect(requests).toContainEqual({ url: `antidraw://app/api/workspaces/${WS}/edits`, method: "DELETE" });
});

it("says which edits aren't showing, and Remove them undoes those", async () => {
  useInspectorStore.setState({ missing: { Card: ["e2"] } });
  await render({ edits: [edit(1, "Card.tsx:3:5", { radius: 24 }), edit(2, "Card.tsx:4:7", { pt: 32, pb: 32, gap: 4 })], applied: [] });
  expect(text()).toContain("2 changes aren't showing: their element is no longer in Card.");
  await press("Remove them");
  expect(text()).toContain("1 unsaved change");
  expect(text()).not.toContain("showing");
});

it("shows each set being applied until it's let go", async () => {
  await render({ edits: [], applied: [{ id: 7, conversationId: "c", edits: [edit(1, "Card.tsx:3:5", { radius: 24 })] }] });
  expect(text()).toContain("The agent is applying 1 change…");
  await press("Stop previewing them");
  expect(text()).not.toContain("applying");
  expect(requests).toContainEqual({ url: `antidraw://app/api/workspaces/${WS}/edits/applied/7`, method: "DELETE" });
});

it("edits the selected element from where its frame showed it", async () => {
  const card = info("Card.tsx:3:5", ["card"]);
  useInspectorStore.setState({ selection: { frame: "Card", info: card } });
  act(() => setCanvasTool("inspect"));
  useDesignStore.setState({ read: { key: JSON.stringify(["Card", "Card.tsx:3:5", 0]), style: base, text: false, seen: null } });
  await render({ edits: [], applied: [] });
  for (const section of ["Auto layout", "Appearance", "Fill", "Stroke", "Effects"]) expect(text()).toContain(section);
  expect(text()).not.toContain("Typography");
  // Hidden: an edit, at once, and to the API.
  await press("Hide");
  expect(text()).toContain("1 unsaved change");
  expect(requests).toContainEqual({ url: `antidraw://app/api/workspaces/${WS}/edits`, method: "PUT" });
});

it("a typed value is taken as typed, ↑ adds 1, and Auto gap is space between", async () => {
  const card = info("Card.tsx:3:5", ["card"]);
  useInspectorStore.setState({ selection: { frame: "Card", info: card } });
  useDesignStore.setState({ read: { key: JSON.stringify(["Card", "Card.tsx:3:5", 0]), style: base, text: false, seen: null } });
  await render({ edits: [], applied: [] });
  const now = () => client.getQueryData<EditList>(queryKeys.edits.byWorkspace(WS))?.edits[0]?.now;
  const gap = [...host.querySelectorAll("input")].find((i) => i.value === "12")!;
  await act(async () => {
    gap.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(gap, "15");
    gap.dispatchEvent(new Event("input", { bubbles: true }));
    gap.blur();
  });
  expect(now()?.gap).toBe(15);
  await act(async () => {
    gap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  expect(now()?.gap).toBe(16);
  await press("Gap mode");
  await press("Auto (space between)");
  expect(now()?.between).toBe(true);
  expect(text()).toContain("Auto");
});

it("Comments with none yet: how to leave one", async () => {
  act(() => setCanvasTool("comment"));
  await render({ edits: [], applied: [] });
  expect(text()).toContain("No comments yet");
  expect(text()).toContain("Pick the Comment tool (C), then click anywhere on a frame");
});

it("Comments: the drafts by Send, the rest Open or Resolved; Pointer keeps the section", async () => {
  act(() => setCanvasTool("comment"));
  await render({ edits: [], applied: [] }, { comments: [comment(1, "Bigger title"), comment(2, "Softer shadow")], chats: [] });
  expect(text()).toContain("Not sent yet");
  expect(button("Send 2 comments to chat")).toBeTruthy();
  act(() => setCanvasTool("pointer"));
  expect(text()).toContain("Bigger title");
  // A tab only changes the section: the tool stays.
  await press("Design (I)");
  expect(text()).toContain("Select an element");
  expect(useInspectorStore.getState().active).toBe(false);
  // Hidden, then back from the canvas's corner.
  await press("Hide panel");
  expect(useDesignStore.getState().panelOpen).toBe(false);
});

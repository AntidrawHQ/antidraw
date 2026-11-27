// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ok, err } from "neverthrow";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { FrameLayout } from "@/renderer/canvas/Canvas";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useInspectorStore } from "@/renderer/inspector/store";

// The shell's editing of the canvas, over the real canvas in jsdom: what the
// clipboard, the keys and the menu ask of the files (mocked: the API), and
// where the frames they make land.

const api = vi.hoisted(() => ({
  createComponents: vi.fn(),
  deleteComponents: vi.fn(),
  getComponentSource: vi.fn(),
  saveFrameLayouts: vi.fn(),
}));
vi.mock("@/renderer/lib/api", async (original) => ({ ...(await original<object>()), ...api }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class {
    m22 = 1;
  };
});

const files = new Map<string, string>();
beforeEach(() => {
  files.clear();
  files.set("Card", "// Card\n");
  files.set("Hero", "// Hero\n");
  api.getComponentSource.mockImplementation(async (_ws: string, name: string) =>
    files.has(name) ? ok({ name, source: files.get(name)! }) : err({ status: 404, code: "NOT_FOUND", message: "gone" }),
  );
  api.saveFrameLayouts.mockImplementation(async () => ok(undefined));
  api.createComponents.mockImplementation(async (_ws: string, components: { name: string; source: string }[]) => {
    const taken = components.find((c) => files.has(c.name));
    if (taken) return err({ status: 409, code: "EXISTS", message: `${taken.name} is already on the canvas` });
    for (const c of components) files.set(c.name, c.source);
    return ok(components.map((c) => c.name));
  });
  api.deleteComponents.mockImplementation(async (_ws: string, names: string[]) => {
    const deleted = names.map((name) => ({ name, source: files.get(name)! }));
    for (const name of names) files.delete(name);
    return ok({ deleted, failed: [] });
  });
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

let workspace = 0;
const savedLayouts: FrameLayout[] = [
  { componentName: "Card", x: 10, y: 20, width: 300, height: 200 },
  { componentName: "Hero", x: 600, y: 20, width: 300, height: 200 },
];

// The canvas as the shell has it: its components and their places are what
// the app knows of the files (its queries). `sync` is the watcher: the list
// read again from the files.
const hosts = { onSeeCode: vi.fn(), onFullscreen: vi.fn() };
async function renderEditing({ keysOff = false, withFind = false }: { keysOff?: boolean; withFind?: boolean } = {}) {
  const { Canvas } = await import("@/renderer/canvas/Canvas");
  const { CanvasEditing } = await import("../CanvasEditing");
  const { CanvasFind } = await import("@/renderer/canvas-find/CanvasFind");
  const { useSaveFrameLayouts } = await import("@/renderer/lib/frame-layout-ops");
  // Each test its own workspace: the undo stacks are the app's.
  const workspaceId = `ws-${++workspace}`;
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const listKey = queryKeys.userComponents.byWorkspace(workspaceId);
  const layoutsKey = queryKeys.frameLayouts.byWorkspace(workspaceId);
  const listed = () => [...files.keys()].map((name) => ({ name }));
  queryClient.setQueryData(listKey, listed());
  queryClient.setQueryData(layoutsKey, savedLayouts.map((l) => ({ ...l, workspaceId })));
  // React Flow's own state, for a test that sets what a held key would.
  const flow: { store?: ReturnType<typeof useStoreApi> } = {};
  const CatchStore = () => {
    flow.store = useStoreApi();
    return null;
  };
  const Host = () => {
    const { data: components = [] } = useQuery({ queryKey: listKey, queryFn: async () => listed() });
    const { data: layouts } = useQuery<FrameLayout[]>({ queryKey: layoutsKey, queryFn: async () => [] });
    // As the shell saves them: a move is still made when the canvas is next up.
    const saveLayouts = useSaveFrameLayouts(workspaceId);
    return (
      <Canvas
        components={components}
        savedLayouts={layouts}
        frameUrl={(name) => `https://site.test/preview?componentName=${name}`}
        onLayoutsChange={saveLayouts}
        onFullscreen={() => {}}
      >
        <CanvasEditing workspaceId={workspaceId} keysOff={keysOff} onFullscreen={hosts.onFullscreen} onSeeCode={hosts.onSeeCode} />
        {withFind && <CanvasFind components={components} />}
        <CatchStore />
      </Canvas>
    );
  };
  const outside = document.body.appendChild(document.createElement("textarea"));
  const mount = async () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ReactFlowProvider>
            <div style={{ width: 1200, height: 800 }}>
              <Host />
            </div>
          </ReactFlowProvider>
        </QueryClientProvider>,
      ),
    );
  };
  await mount();
  return {
    sync: () => act(async () => queryClient.invalidateQueries({ queryKey: listKey })),
    // The canvas down and up again (the dev server restarted), on what the
    // app knows now.
    remount: async () => {
      act(() => root!.unmount());
      await mount();
    },
    outside,
    flow,
    // Where the app has each frame saved to go.
    places: () =>
      Object.fromEntries((queryClient.getQueryData<FrameLayout[]>(layoutsKey) ?? []).map((l) => [l.componentName, `${l.x},${l.y}`])),
    place: (layout: FrameLayout) =>
      queryClient.setQueryData<FrameLayout[]>(layoutsKey, (saved = []) => [...saved, { ...layout, workspaceId } as FrameLayout]),
  };
}

const node = (name: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${name}-1"]`)!;
const positions = () =>
  Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((n) => [n.dataset.id, n.style.transform]),
  );
const selected = () =>
  [...document.querySelectorAll<HTMLElement>(".react-flow__node.selected")].map((n) => n.dataset.id);

// A press on the frame (the canvas is then the part of the window in use),
// and Enter, which selects it.
const pick = (name: string) =>
  act(async () => {
    node(name).dispatchEvent(new Event("pointerdown", { bubbles: true }));
    node(name).focus();
    node(name).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });

// jsdom has no DataTransfer: the clipboard's, as a page sees it.
const clipboard = () => {
  const data = new Map<string, string>();
  return {
    data,
    getData: (type: string) => data.get(type) ?? "",
    setData: (type: string, value: string) => void data.set(type, value),
    get types() {
      return [...data.keys()];
    },
  };
};
// A change made, and drawn: its file written, and the canvas showing it.
// Each turn its own act: what one draws, the next goes on from.
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
const clipboardEvent = async (type: "copy" | "cut" | "paste", clipboardData: ReturnType<typeof clipboard>) => {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    document.dispatchEvent(event);
  });
  await settle();
};

it("copies the selected frame and pastes it beside it, as a new file, selected", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  const data = clipboard();
  await clipboardEvent("copy", data);
  await clipboardEvent("paste", data);
  await canvas.sync();
  expect({
    // Its id, which a paste knows it by, and its names, for a paste elsewhere.
    clipboard: { ...Object.fromEntries(data.data), "application/x-antidraw-frames": data.getData("application/x-antidraw-frames").length },
    created: api.createComponents.mock.calls.map(([, c]) => c),
    at: positions()["CardCopy-1"],
    selected: selected(),
  }).toMatchInlineSnapshot(`
    {
      "at": "translate(50px,60px)",
      "clipboard": {
        "application/x-antidraw-frames": 36,
        "text/plain": "Card",
      },
      "created": [
        [
          {
            "name": "CardCopy",
            "source": "// Card
    ",
          },
        ],
      ],
      "selected": [
        "CardCopy-1",
      ],
    }
  `);
});

it("leaves the page's clipboard be with nothing selected, and text copied since", async () => {
  await renderEditing();
  await pick("Card");
  const copied = clipboard();
  await clipboardEvent("copy", copied);
  const text = clipboard();
  text.setData("text/plain", "some text");
  await clipboardEvent("paste", text);
  expect(api.createComponents).not.toHaveBeenCalled();
});

it("deletes the selected frame to the trash, and undo writes it back where it was", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  await press("Backspace");
  await settle();
  await canvas.sync();
  const afterDelete = Object.keys(positions());
  await press("z", { ctrlKey: true });
  await settle();
  await canvas.sync();
  expect({
    deleted: api.deleteComponents.mock.calls.map(([, names]) => names),
    afterDelete,
    restored: api.createComponents.mock.calls.map(([, c]) => c),
    at: positions()["Card-1"],
  }).toMatchInlineSnapshot(`
    {
      "afterDelete": [
        "Hero-1",
      ],
      "at": "translate(10px,20px)",
      "deleted": [
        [
          "Card",
        ],
      ],
      "restored": [
        [
          {
            "name": "Card",
            "source": "// Card
    ",
          },
        ],
      ],
    }
  `);
});

it("undoes a paste only if the pasted file is as it was written", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  const data = clipboard();
  await clipboardEvent("copy", data);
  await clipboardEvent("paste", data);
  await canvas.sync();
  await press("z", { ctrlKey: true });
  await settle();
  expect(api.deleteComponents.mock.calls.map(([, names, expected]) => ({ names, expected }))).toMatchInlineSnapshot(`
    [
      {
        "expected": [
          {
            "name": "CardCopy",
            "source": "// Card
    ",
          },
        ],
        "names": [
          "CardCopy",
        ],
      },
    ]
  `);
});

it("undoes and redoes a move made with the arrow keys", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await renderEditing();
    await pick("Hero");
    await press("ArrowRight");
    await press("ArrowRight");
    const moved = positions()["Hero-1"];
    await press("z", { ctrlKey: true });
    const undone = positions()["Hero-1"];
    await press("z", { ctrlKey: true, shiftKey: true });
    expect({ moved, undone, redone: positions()["Hero-1"] }).toMatchInlineSnapshot(`
      {
        "moved": "translate(610px,20px)",
        "redone": "translate(610px,20px)",
        "undone": "translate(600px,20px)",
      }
    `);
  } finally {
    vi.useRealTimers();
  }
});

it("leaves the keys to a text field being typed in", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  canvas.outside.focus();
  await press("Backspace", {}, canvas.outside);
  await press("a", { ctrlKey: true }, canvas.outside);
  await press("d", { ctrlKey: true }, canvas.outside);
  expect({ deleted: api.deleteComponents.mock.calls.length, created: api.createComponents.mock.calls.length, selected: selected() })
    .toEqual({ deleted: 0, created: 0, selected: ["Card-1"] });
});

it("acts on the canvas from anywhere else in the window, not only after a press on it", async () => {
  await renderEditing();
  await pick("Card");
  // A press outside the canvas (the chat, the titlebar): the keys still act.
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  await press("d", { ctrlKey: true }, document.body);
  expect(api.createComponents.mock.calls.length).toBe(1);
});

it("has its keys from the start, before any press", async () => {
  await renderEditing();
  await press("a", { ctrlKey: true }, document.body);
  expect(selected()).toEqual(["Card-1", "Hero-1"]);
});

it("selects all, clears the selection, and steps from frame to frame", async () => {
  await renderEditing();
  await pick("Card");
  await press("a", { ctrlKey: true });
  const all = selected();
  await press("Escape");
  const none = selected();
  await press("Tab");
  const first = selected();
  await press("Tab");
  const second = selected();
  await press("Tab", { shiftKey: true });
  expect({ all, none, first, second, back: selected() }).toEqual({
    all: ["Card-1", "Hero-1"],
    none: [],
    first: ["Card-1"],
    second: ["Hero-1"],
    back: ["Card-1"],
  });
});

it("opens its menu on a right-click on a frame, selecting it, and duplicates from it", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  await act(async () => {
    node("Hero").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 700, clientY: 100 }));
  });
  const items = [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);
  const picked = selected();
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((i) => i.textContent?.startsWith("Duplicate"))!.click();
  });
  await settle();
  await canvas.sync();
  expect({
    items,
    picked,
    created: api.createComponents.mock.calls.map(([, c]) => c),
    at: positions()["HeroCopy-1"],
  }).toMatchInlineSnapshot(`
    {
      "at": "translate(640px,60px)",
      "created": [
        [
          {
            "name": "HeroCopy",
            "source": "// Hero
    ",
          },
        ],
      ],
      "items": [
        "CopyCtrl+C",
        "CutCtrl+X",
        "PasteCtrl+V",
        "DuplicateCtrl+D",
        "Open in window",
        "See code",
        "Delete⌫",
      ],
      "picked": [
        "Hero-1",
      ],
    }
  `);
});

it("cuts a frame and pastes it back under its own name, and one undo each", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  const data = clipboard();
  await clipboardEvent("cut", data);
  await canvas.sync();
  const afterCut = Object.keys(positions());
  await clipboardEvent("paste", data);
  await canvas.sync();
  const pasted = api.createComponents.mock.calls.map(([, c]) => c.map((x: { name: string }) => x.name));
  // Undo the paste, then the cut.
  await press("z", { ctrlKey: true });
  await settle();
  await canvas.sync();
  await press("z", { ctrlKey: true });
  await settle();
  await canvas.sync();
  expect({ afterCut, pasted, files: [...files.keys()].sort(), at: positions()["Card-1"] }).toEqual({
    afterCut: ["Hero-1"],
    pasted: [["Card"]],
    files: ["Card", "Hero"],
    at: "translate(10px,20px)",
  });
});

const menuItems = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];
const rightClick = (target: Element) =>
  act(async () => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 700, clientY: 100 }));
  });
const choose = (label: string) =>
  act(async () => {
    menuItems().find((i) => i.textContent?.startsWith(label))!.click();
  });

it("gives each of two duplicates pressed one after the other its own name", async () => {
  await renderEditing();
  await pick("Card");
  // The second before the first is written, let alone drawn.
  await act(async () => {
    for (let i = 0; i < 2; i++) {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
    }
  });
  await settle();
  expect({
    created: api.createComponents.mock.calls.map(([, c]) => c.map((x: { name: string }) => x.name)),
    // The second is of the first's copy, selected by then: further on, not under it.
    at: [positions()["CardCopy-1"], positions()["CardCopy2-1"]],
    selected: selected(),
  }).toEqual({
    created: [["CardCopy"], ["CardCopy2"]],
    at: ["translate(50px,60px)", "translate(90px,100px)"],
    selected: ["CardCopy2-1"],
  });
});

it("undoes a delete and the move before it, pressed one after the other, back to where the frame began", async () => {
  await renderEditing();
  await pick("Hero");
  await press("ArrowRight");
  await press("ArrowRight");
  await press("Backspace");
  await settle();
  const deleted = Object.keys(positions());
  // The second undo before the first has its frame back on the canvas.
  await act(async () => {
    for (let i = 0; i < 2; i++) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    }
  });
  await settle();
  const undone = positions()["Hero-1"];
  await press("z", { ctrlKey: true, shiftKey: true }, document.body);
  await settle();
  expect({ deleted, undone, redone: positions()["Hero-1"] }).toEqual({
    deleted: ["Card-1"],
    undone: "translate(600px,20px)",
    redone: "translate(610px,20px)",
  });
});

it("undoes on the canvas that's up now what was done on one since taken down", async () => {
  const canvas = await renderEditing();
  await pick("Hero");
  await press("ArrowRight");
  // Saved, as the shell saves a move a moment after it.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
  await pick("Card");
  await press("Backspace");
  await settle();
  await canvas.remount();
  const remounted = positions();
  await pick("Hero");
  await press("z", { ctrlKey: true });
  await settle();
  const restored = positions()["Card-1"];
  await press("z", { ctrlKey: true });
  await settle();
  expect({ remounted, restored, moved: positions()["Hero-1"] }).toEqual({
    remounted: { "Hero-1": "translate(605px,20px)" },
    restored: "translate(10px,20px)",
    moved: "translate(600px,20px)",
  });
});

it("brings every frame back to a canvas emptied of them", async () => {
  await renderEditing();
  await pick("Card");
  await press("a", { ctrlKey: true });
  await press("Backspace");
  await settle();
  const emptied = Object.keys(positions());
  await press("z", { ctrlKey: true }, document.body);
  await settle();
  expect({ emptied, back: positions() }).toEqual({
    emptied: [],
    back: { "Card-1": "translate(10px,20px)", "Hero-1": "translate(600px,20px)" },
  });
});

it("makes its menu for the frame right-clicked, not the one selected before", async () => {
  await renderEditing();
  await pick("Card");
  await rightClick(node("Hero"));
  await choose("See code");
  // And with none selected before: the frame's own items are there.
  await press("Escape", {}, document.body);
  await rightClick(node("Card"));
  const items = menuItems().map((i) => i.textContent);
  await choose("Open in window");
  expect({
    code: hosts.onSeeCode.mock.calls,
    items: items.filter((i) => i === "See code" || i === "Open in window"),
    window: hosts.onFullscreen.mock.calls,
  }).toEqual({
    code: [["Hero"]],
    items: ["Open in window", "See code"],
    window: [["https://site.test/preview?componentName=Card"]],
  });
});

it("leaves Escape to the Inspect tool while it's on", async () => {
  await renderEditing();
  await pick("Card");
  // Off the frame: React Flow has a focused frame's Escape itself.
  await act(async () => (document.activeElement as HTMLElement).blur());
  useInspectorStore.setState({ active: true });
  try {
    await press("Escape", {}, document.body);
    const inspecting = selected();
    useInspectorStore.setState({ active: false });
    await press("Escape", {}, document.body);
    expect({ inspecting, after: selected() }).toEqual({ inspecting: ["Card-1"], after: [] });
  } finally {
    useInspectorStore.setState({ active: false });
  }
});

it("keeps the keys after a press that only closed its menu", async () => {
  await renderEditing();
  await rightClick(node("Card"));
  // The menu takes every press while it's open: this one lands on the page.
  await act(async () => {
    document.documentElement.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  await settle();
  const open = menuItems().length;
  await press("Backspace", {}, document.body);
  await settle();
  expect({ open, deleted: api.deleteComponents.mock.calls.map(([, names]) => names) }).toEqual({ open: 0, deleted: [["Card"]] });
});

it("redoes an undone paste as the frames the trash took, and cuts nothing the trash refused", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  await press("a", { ctrlKey: true });
  const data = clipboard();
  await clipboardEvent("copy", data);
  await clipboardEvent("paste", data);
  // The trash takes CardCopy and refuses HeroCopy.
  api.deleteComponents.mockImplementationOnce(async () => {
    files.delete("CardCopy");
    return ok({ deleted: [{ name: "CardCopy", source: "// Card\n" }], failed: ["HeroCopy"] });
  });
  await press("z", { ctrlKey: true });
  await settle();
  await canvas.sync();
  await press("z", { ctrlKey: true, shiftKey: true });
  await settle();
  const redone = api.createComponents.mock.calls.at(-1)![1].map((c: { name: string }) => c.name);

  // And refuses every frame of a cut: nothing to undo, nothing to paste.
  api.deleteComponents.mockImplementationOnce(async (_ws: string, names: string[]) => ok({ deleted: [], failed: names }));
  await press("Escape");
  await pick("Hero");
  const cut = clipboard();
  await clipboardEvent("cut", cut);
  const made = api.createComponents.mock.calls.length;
  await clipboardEvent("paste", cut);
  expect({ redone, pasted: api.createComponents.mock.calls.length - made, frames: Object.keys(positions()).sort() }).toEqual({
    redone: ["CardCopy"],
    pasted: 0,
    frames: ["Card-1", "CardCopy-1", "Hero-1", "HeroCopy-1"],
  });
});

it("selects a duplicate alone, though the key that made it is still down", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  // Cmd, held through Cmd+D, is React Flow's key for adding to a selection.
  await act(async () => canvas.flow.store!.setState({ multiSelectionActive: true }));
  await press("d", { ctrlKey: true });
  await settle();
  expect(selected()).toEqual(["CardCopy-1"]);
});

const keys = (key: string, init: KeyboardEventInit, times: number, target: EventTarget = document.body) =>
  act(async () => {
    for (let i = 0; i < times; i++) {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    }
  });

it("deletes a frame once, though Backspace is pressed again before it's gone", async () => {
  await renderEditing();
  await pick("Card");
  await keys("Backspace", {}, 2, document.activeElement!);
  await settle();
  expect(api.deleteComponents.mock.calls.map(([, names]) => names)).toEqual([["Card"]]);
});

it("keeps a cut's frames to paste, though it's cut again before it's gone", async () => {
  await renderEditing();
  await pick("Card");
  const first = clipboard();
  const second = clipboard();
  await act(async () => {
    for (const data of [first, second]) {
      const event = new Event("cut", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      document.dispatchEvent(event);
    }
  });
  await settle();
  await clipboardEvent("paste", first);
  expect({
    // The second cut was of nothing: the page's own.
    second: second.types,
    deleted: api.deleteComponents.mock.calls.map(([, names]) => names),
    pasted: api.createComponents.mock.calls.map(([, c]) => c.map((x: { name: string }) => x.name)),
  }).toEqual({ second: [], deleted: [["Card"]], pasted: [["Card"]] });
});

it("leaves a frame its place when an undo that would write over it is refused", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  await press("Backspace");
  await settle();
  // The agent writes a Card of its own, and it's put somewhere.
  files.set("Card", "// the agent's\n");
  canvas.place({ componentName: "Card", x: 900, y: 500, width: 300, height: 200 });
  await canvas.sync();
  await press("z", { ctrlKey: true }, document.body);
  await settle();
  expect({ source: files.get("Card"), place: canvas.places().Card }).toEqual({ source: "// the agent's\n", place: "900,500" });
});

it("copies the frame, not text left selected elsewhere in the window", async () => {
  await renderEditing();
  await pick("Card");
  // A chat message's text, selected, and still selected at the press on the
  // frame: Chromium keeps it through one. (jsdom drops it on focus, so the
  // press here is only the press.)
  const message = document.body.appendChild(document.createElement("p"));
  message.textContent = "a chat message";
  const range = document.createRange();
  range.selectNodeContents(message);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  const before = document.getSelection()!.toString();
  await act(async () => {
    node("Card").dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  const data = clipboard();
  await clipboardEvent("copy", data);
  expect({ before, after: document.getSelection()!.toString(), copied: data.getData("text/plain") }).toEqual({
    before: "a chat message",
    after: "",
    copied: "Card",
  });
});

it("leaves a right press on the canvas to React Flow, which knows a click from a pan", async () => {
  await renderEditing();
  const pane = document.querySelector(".react-flow__pane")!;
  const rightPress = (init: MouseEventInit) =>
    act(async () => {
      pane.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, ...init }));
    });
  // The press that may begin a pan: no menu yet.
  await rightPress({ button: 2 });
  const onPress = menuItems().length;
  // Ctrl+click pans nothing: its menu, at once.
  await rightPress({ button: 0, ctrlKey: true });
  const onCtrlClick = menuItems().map((i) => i.textContent);
  await press("Escape", {}, document.activeElement ?? document.body);
  await settle();
  // And a right press let go where it was: React Flow's word that it was a click.
  const mouse = (type: string, target: EventTarget, at = 300) =>
    act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: at, clientY: at });
      // d3-zoom listens on the event's window; jsdom won't take vitest's as one.
      Object.defineProperty(event, "view", { value: window });
      target.dispatchEvent(event);
    });
  // Dragged first (a pan): still no menu.
  await mouse("mousedown", pane);
  await mouse("mousemove", window, 340);
  await mouse("mousemove", window, 380);
  await mouse("mouseup", window, 380);
  await settle();
  const onPan = menuItems().length;
  await mouse("mousedown", pane);
  await mouse("mouseup", window);
  await settle();
  expect({ onPress, onPan, onCtrlClick, onClick: menuItems().map((i) => i.textContent) }).toEqual({
    onPress: 0,
    onPan: 0,
    onCtrlClick: ["Paste hereCtrl+V", "Select allCtrl+A"],
    onClick: ["Paste hereCtrl+V", "Select allCtrl+A"],
  });
});

it("does nothing while its keys are off (the dashboard is over the canvas)", async () => {
  await renderEditing({ keysOff: true });
  await pick("Card");
  await press("Backspace");
  await press("d", { ctrlKey: true });
  const data = clipboard();
  await clipboardEvent("copy", data);
  await rightClick(node("Card"));
  expect({
    deleted: api.deleteComponents.mock.calls.length,
    created: api.createComponents.mock.calls.length,
    copied: data.types,
    menu: menuItems().length,
  }).toEqual({ deleted: 0, created: 0, copied: [], menu: 0 });
});

it("pastes again under a pointer that hasn't moved further on, not on top", async () => {
  await renderEditing();
  await pick("Card");
  const data = clipboard();
  await clipboardEvent("copy", data);
  await act(async () => {
    const move = new Event("pointermove", { bubbles: true });
    Object.assign(move, { clientX: 400, clientY: 300 });
    document.querySelector(".react-flow")!.dispatchEvent(move);
  });
  await clipboardEvent("paste", data);
  await clipboardEvent("paste", data);
  const at = (name: string) => positions()[`${name}-1`]!.match(/-?\d+/g)!.map(Number);
  const [first, second] = [at("CardCopy"), at("CardCopy2")];
  expect([second[0]! - first[0]!, second[1]! - first[1]!]).toEqual([40, 40]);
});

it("undoes a paste one of whose files is gone already, and redoes the rest", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  await press("a", { ctrlKey: true });
  const data = clipboard();
  await clipboardEvent("copy", data);
  await clipboardEvent("paste", data);
  // The agent has deleted HeroCopy since; the canvas hasn't heard.
  api.deleteComponents.mockImplementationOnce(async () => {
    files.delete("CardCopy");
    files.delete("HeroCopy");
    return ok({ deleted: [{ name: "CardCopy", source: "// Card\n" }], failed: [], missing: ["HeroCopy"] });
  });
  await press("z", { ctrlKey: true });
  await settle();
  const undone = Object.keys(positions()).sort();
  await press("z", { ctrlKey: true, shiftKey: true }, document.body);
  await settle();
  await canvas.sync();
  expect({ undone, redone: Object.keys(positions()).sort() }).toEqual({
    undone: ["Card-1", "Hero-1"],
    redone: ["Card-1", "CardCopy-1", "Hero-1"],
  });
});

// The find (⌘F) over the canvas: its field keeps every key it's typed in,
// Tab included, which would otherwise take the focus to its buttons, where
// Backspace and Escape are the canvas's.
it("leaves the find's keys to the find: Tab, Backspace, Escape and a right-click in it", async () => {
  await renderEditing({ withFind: true });
  Element.prototype.scrollIntoView ??= () => {};
  await pick("Card");
  await press("f", { ctrlKey: true, code: "KeyF" });
  const field = document.querySelector<HTMLInputElement>('input[placeholder="Find a component"]')!;
  expect(document.activeElement).toBe(field);

  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => {
    field.dispatchEvent(tab);
  });
  const buttons = [...field.closest(".w-\\[280px\\]")!.querySelectorAll("button")];
  await press("Backspace", {}, field);
  await act(async () => {
    field.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 900, clientY: 20 }));
  });
  const menu = document.querySelectorAll("[role=menuitem]").length;
  await press("Escape", {}, field);
  await settle();

  expect({
    tabStays: tab.defaultPrevented,
    tabbable: buttons.filter((b) => b.tabIndex >= 0).length,
    deleted: api.deleteComponents.mock.calls.length,
    menu,
    findOpen: !!document.querySelector('input[placeholder="Find a component"]'),
    selected: selected(),
  }).toEqual({ tabStays: true, tabbable: 0, deleted: 0, menu: 0, findOpen: false, selected: ["Card-1"] });
});

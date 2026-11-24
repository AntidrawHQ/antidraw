// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, err } from "neverthrow";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { FrameLayout } from "@/renderer/canvas/Canvas";

// The shell's editing of the canvas, over the real canvas in jsdom: what the
// clipboard, the keys and the menu ask of the files (mocked: the API), and
// where the frames they make land.

const api = vi.hoisted(() => ({
  createComponents: vi.fn(),
  deleteComponents: vi.fn(),
  getComponentSource: vi.fn(),
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
  api.createComponents.mockImplementation(async (_ws: string, components: { name: string; source: string }[]) => {
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

// The canvas as the shell has it, its components the files: `sync` hands
// it the files as they are now, as the watcher would.
async function renderEditing() {
  const { Canvas } = await import("@/renderer/canvas/Canvas");
  const { CanvasEditing } = await import("../CanvasEditing");
  // Each test its own workspace: the undo stacks are the app's.
  const workspaceId = `ws-${++workspace}`;
  const queryClient = new QueryClient();
  const container = document.body.appendChild(document.createElement("div"));
  const outside = document.body.appendChild(document.createElement("textarea"));
  const render = () =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <ReactFlowProvider>
          <div style={{ width: 1200, height: 800 }}>
            <Canvas
              components={[...files.keys()].map((name) => ({ name }))}
              savedLayouts={savedLayouts}
              frameUrl={(name) => `https://site.test/preview?componentName=${name}`}
              onFullscreen={() => {}}
            >
              <CanvasEditing workspaceId={workspaceId} keysOff={false} onFullscreen={() => {}} onSeeCode={() => {}} />
            </Canvas>
          </div>
        </ReactFlowProvider>
      </QueryClientProvider>,
    );
  root = createRoot(container);
  await act(async () => render());
  return { sync: () => act(async () => render()), outside };
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
const clipboardEvent = (type: "copy" | "cut" | "paste", clipboardData: ReturnType<typeof clipboard>) =>
  act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    document.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

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
      "at": "translate(48px,64px)",
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
        "expected": {
          "CardCopy": "// Card
    ",
        },
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
        "moved": "translate(616px,24px)",
        "redone": "translate(616px,24px)",
        "undone": "translate(600px,20px)",
      }
    `);
  } finally {
    vi.useRealTimers();
  }
});

it("leaves the keys to a text field being typed in, and to the rest of the window", async () => {
  const canvas = await renderEditing();
  await pick("Card");
  // Typing: the field's own.
  canvas.outside.focus();
  await press("Backspace", {}, canvas.outside);
  await press("a", { ctrlKey: true }, canvas.outside);
  // A press outside the canvas: the window's other parts have the keys.
  await act(async () => {
    canvas.outside.blur();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  await press("Backspace", {}, document.body);
  await press("d", { ctrlKey: true }, document.body);
  expect({ deleted: api.deleteComponents.mock.calls.length, created: api.createComponents.mock.calls.length, selected: selected() })
    .toEqual({ deleted: 0, created: 0, selected: ["Card-1"] });
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
      "at": "translate(640px,64px)",
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

// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { CanvasControls, FrameLayer, FrameLayout } from "../Canvas";

// The shared canvas in jsdom, as the shell and the share page render it: what
// each frame loads, which messages may size a frame, and where layout changes go.

// What jsdom lacks and React Flow or the canvas reads.
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

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const SITE = "https://paper-shaders.sites.test";
const frameUrl = (componentName: string) =>
  `${SITE}/preview?componentName=${encodeURIComponent(componentName)}`;

async function renderCanvas(
  onLayoutsChange?: (layouts: FrameLayout[]) => void,
  frameLayer?: FrameLayer,
  {
    components = [{ name: "Card" }, { name: "Hero Card" }],
    savedLayouts = [{ componentName: "Card", x: 10, y: 20, width: 300, height: 200 }],
    strict = false,
    children,
  }: {
    components?: { name: string }[];
    savedLayouts?: FrameLayout[];
    strict?: boolean;
    children?: ReactNode;
  } = {},
) {
  const { Canvas } = await import("../Canvas");
  const container = document.body.appendChild(document.createElement("div"));
  const Mode = strict ? StrictMode : "div";
  const render = (onChange: typeof onLayoutsChange, list = components) =>
    root!.render(
      <Mode>
        <ReactFlowProvider>
          <div style={{ width: 1200, height: 800 }}>
            <Canvas
              components={list}
              savedLayouts={savedLayouts}
              frameUrl={frameUrl}
              onLayoutsChange={onChange}
              onFullscreen={() => {}}
              frameLayer={frameLayer}
            >
              {children}
            </Canvas>
          </div>
        </ReactFlowProvider>
      </Mode>,
    );
  root = createRoot(container);
  await act(async () => render(onLayoutsChange));
  return {
    rerender: (onChange: typeof onLayoutsChange) => act(() => render(onChange)),
    addComponents: (more: { name: string }[]) =>
      act(() => render(onLayoutsChange, [...components, ...more])),
    // The host's list now, as after a component's file is added or deleted.
    setComponents: (list: { name: string }[]) => act(() => render(onLayoutsChange, list)),
  };
}

const frames = () =>
  [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((node) => ({
    node: node.dataset.id,
    size: `${node.style.width} × ${node.style.height}`,
    src: node.querySelector("iframe")?.getAttribute("src"),
  }));

const positions = () =>
  Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((node) => [
      node.dataset.id,
      node.style.transform,
    ]),
  );

const postSize = (origin: string, width: number, height: number, componentName = "Card") =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { type: "component-size", componentName, width, height },
      }),
    );
  });

it("gives each component a frame of its Preview page", async () => {
  await renderCanvas();
  expect(frames()).toMatchInlineSnapshot(`
    [
      {
        "node": "Card-1",
        "size": "300px × 200px",
        "src": "https://paper-shaders.sites.test/preview?componentName=Card",
      },
      {
        "node": "Hero Card-1",
        "size": "400px × 300px",
        "src": "https://paper-shaders.sites.test/preview?componentName=Hero%20Card",
      },
    ]
  `);
});

it("lets only the frames' origin size them", async () => {
  await renderCanvas();
  await postSize("https://elsewhere.test", 900, 900);
  const fromElsewhere = frames()[0]!.size;
  await postSize(SITE, 640, 480);
  expect({ fromElsewhere, fromTheSite: frames()[0]!.size }).toMatchInlineSnapshot(`
    {
      "fromElsewhere": "300px × 200px",
      "fromTheSite": "640px × 480px",
    }
  `);
});

it("hands a failed frame's place in the loading queue to the next frame, on its origin's word only", async () => {
  const components = Array.from({ length: 11 }, (_, i) => ({ name: `Card ${i}` }));
  await renderCanvas(undefined, undefined, { components, savedLayouts: [] });
  await act(async () => {});
  // jsdom loads no page, so the ten frames let in keep their places.
  const loading = () => frames().filter((frame) => frame.src).map((frame) => frame.node!.replace(/-1$/, ""));
  const postFailed = (origin: string, componentName: string) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { origin, data: { type: "component-failed", componentName } }),
      );
    });

  const atFirst = loading();
  await postFailed("https://elsewhere.test", atFirst[0]!);
  const afterElsewhere = loading().length;
  await postFailed(SITE, atFirst[0]!);
  expect({ atFirst: atFirst.length, afterElsewhere, afterTheSite: loading().length }).toEqual({
    atFirst: 10,
    afterElsewhere: 10,
    afterTheSite: 11,
  });
});

it("lines new frames up after the others, and keeps them apart as they grow", async () => {
  const canvas = await renderCanvas();
  const placed = positions();
  // The saved frame and the new one size themselves to their components.
  await postSize(SITE, 640, 480);
  await postSize(SITE, 900, 300, "Hero Card");
  const grown = positions();
  await canvas.addComponents([{ name: "Footer" }]);
  const added = positions();
  await postSize(SITE, 1000, 300, "Hero Card");
  expect({ placed, grown, added, regrown: positions() }).toMatchInlineSnapshot(`
    {
      "added": {
        "Card-1": "translate(10px,20px)",
        "Footer-1": "translate(1750px,20px)",
        "Hero Card-1": "translate(750px,20px)",
      },
      "grown": {
        "Card-1": "translate(10px,20px)",
        "Hero Card-1": "translate(750px,20px)",
      },
      "placed": {
        "Card-1": "translate(10px,20px)",
        "Hero Card-1": "translate(410px,20px)",
      },
      "regrown": {
        "Card-1": "translate(10px,20px)",
        "Footer-1": "translate(1850px,20px)",
        "Hero Card-1": "translate(750px,20px)",
      },
    }
  `);
});

it("lines new frames up after the frame reaching furthest right, level with it", async () => {
  await renderCanvas(undefined, undefined, {
    components: [{ name: "Wide" }, { name: "Narrow" }, { name: "New" }],
    savedLayouts: [
      { componentName: "Wide", x: 0, y: 0, width: 2000, height: 300 },
      { componentName: "Narrow", x: 500, y: 400, width: 300, height: 200 },
    ],
  });
  expect(positions()["New-1"]).toBe("translate(2100px,0px)");
});

it("starts the row at 100, 100 when nothing is saved", async () => {
  await renderCanvas(undefined, undefined, { savedLayouts: [] });
  expect(positions()).toMatchInlineSnapshot(`
    {
      "Card-1": "translate(100px,100px)",
      "Hero Card-1": "translate(600px,100px)",
    }
  `);
});

it("leaves the frames where they are once the user picks one", async () => {
  await renderCanvas();
  const hero = document.querySelector<HTMLElement>('.react-flow__node[data-id="Hero Card-1"]')!;
  await act(async () => {
    hero.focus();
    hero.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  // Card grows past the gap it had before Hero Card.
  await postSize(SITE, 640, 480);
  expect(positions()["Hero Card-1"]).toBe("translate(410px,20px)");
});

it("saves a change with the callback given when it happened", async () => {
  vi.useFakeTimers();
  try {
    const before = vi.fn();
    const after = vi.fn();
    const canvas = await renderCanvas(before);
    await postSize(SITE, 640, 480);
    // The host moves on (the shell, to another workspace) before the save.
    canvas.rerender(after);
    await act(async () => vi.advanceTimersByTime(500));
    expect({ before: before.mock.calls, after: after.mock.calls }).toMatchInlineSnapshot(`
      {
        "after": [],
        "before": [
          [
            [
              {
                "componentName": "Card",
                "height": 480,
                "width": 640,
                "x": 10,
                "y": 20,
              },
              {
                "componentName": "Hero Card",
                "height": 300,
                "width": 400,
                "x": 750,
                "y": 20,
              },
            ],
          ],
        ],
      }
    `);
  } finally {
    vi.useRealTimers();
  }
});

it("takes a deleted component's frame off the canvas, out of the row and out of the save", async () => {
  vi.useFakeTimers();
  try {
    const onLayoutsChange = vi.fn();
    // StrictMode runs the sync's updater twice.
    const canvas = await renderCanvas(onLayoutsChange, undefined, {
      components: [{ name: "Card" }, { name: "Hero Card" }, { name: "Footer" }],
      strict: true,
    });
    const placed = positions();
    await canvas.setComponents([{ name: "Card" }, { name: "Footer" }]);
    const deleted = positions();
    const toolbars = [...document.querySelectorAll<HTMLElement>(".canvas-frame-toolbar")].map(
      (toolbar) => toolbar.dataset.id,
    );
    // Footer is still settling: it grows to its component, and the canvas saves.
    await postSize(SITE, 500, 300, "Footer");
    await act(async () => vi.advanceTimersByTime(500));
    expect({ placed, deleted, toolbars, saved: onLayoutsChange.mock.calls.at(-1)?.[0] })
      .toMatchInlineSnapshot(`
        {
          "deleted": {
            "Card-1": "translate(10px,20px)",
            "Footer-1": "translate(410px,20px)",
          },
          "placed": {
            "Card-1": "translate(10px,20px)",
            "Footer-1": "translate(910px,20px)",
            "Hero Card-1": "translate(410px,20px)",
          },
          "saved": [
            {
              "componentName": "Card",
              "height": 200,
              "width": 300,
              "x": 10,
              "y": 20,
            },
            {
              "componentName": "Footer",
              "height": 300,
              "width": 500,
              "x": 410,
              "y": 20,
            },
          ],
          "toolbars": [
            "Card-1",
            "Footer-1",
          ],
        }
      `);
  } finally {
    vi.useRealTimers();
  }
});

it("draws a host's layer over each frame, handing it the frame's iframe", async () => {
  await renderCanvas(undefined, ({ componentName, iframe }) => (
    <i data-layer={componentName} data-src={iframe?.getAttribute("src") ?? ""} />
  ));
  // The iframe appears once a load slot is free, after the first render.
  await act(async () => {});
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-layer]")].map((el) => ({ ...el.dataset })),
  ).toMatchInlineSnapshot(`
    [
      {
        "layer": "Card",
        "src": "https://paper-shaders.sites.test/preview?componentName=Card",
      },
      {
        "layer": "Hero Card",
        "src": "https://paper-shaders.sites.test/preview?componentName=Hero%20Card",
      },
    ]
  `);
});

// The canvas's controls, for a host that edits it, caught from inside it.
async function withControls(options: Parameters<typeof renderCanvas>[2] = {}, onLayoutsChange?: (layouts: FrameLayout[]) => void) {
  const { useCanvasControls } = await import("../Canvas");
  const caught: { controls?: CanvasControls } = {};
  const Catch = () => {
    caught.controls = useCanvasControls();
    return null;
  };
  const canvas = await renderCanvas(onLayoutsChange, undefined, { ...options, children: <Catch /> });
  return { canvas, controls: caught.controls! };
}

const pressOn = (id: string, key: string) =>
  act(async () => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
    node.focus();
    node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

it("puts a frame the host placed where it said, once, and lines the rest up, leaving the others be", async () => {
  const { canvas, controls } = await withControls();
  controls.placeFrames([{ componentName: "CardCopy", x: 48, y: 640, width: 300, height: 200 }]);
  await canvas.addComponents([{ name: "CardCopy" }, { name: "Footer" }]);
  const placed = { positions: positions(), sizes: frames().map((f) => `${f.node}: ${f.size}`) };
  // Gone and back (the agent wrote it again): lined up like any new frame.
  await canvas.setComponents([{ name: "Card" }, { name: "Hero Card" }, { name: "Footer" }]);
  await canvas.setComponents([{ name: "Card" }, { name: "Hero Card" }, { name: "Footer" }, { name: "CardCopy" }]);
  expect({ placed, again: positions()["CardCopy-1"] }).toMatchInlineSnapshot(`
    {
      "again": "translate(1410px,20px)",
      "placed": {
        "positions": {
          "Card-1": "translate(10px,20px)",
          "CardCopy-1": "translate(48px,640px)",
          "Footer-1": "translate(910px,20px)",
          "Hero Card-1": "translate(410px,20px)",
        },
        "sizes": [
          "Card-1: 300px × 200px",
          "Hero Card-1: 400px × 300px",
          "CardCopy-1: 300px × 200px",
          "Footer-1: 400px × 300px",
        ],
      },
    }
  `);
});

it("forgets a placement the host cancelled", async () => {
  const { canvas, controls } = await withControls();
  const cancel = controls.placeFrames([{ componentName: "CardCopy", x: 48, y: 640, width: 300, height: 200 }]);
  cancel();
  await canvas.addComponents([{ name: "CardCopy" }]);
  expect(positions()["CardCopy-1"]).toBe("translate(910px,20px)");
});

it("tells the host of each move the user makes once it ends, from where it began", async () => {
  vi.useFakeTimers();
  try {
    const { controls } = await withControls();
    const moves = vi.fn();
    controls.onFramesMoved(moves);
    await pressOn("Hero Card-1", "Enter");
    for (let i = 0; i < 3; i++) await pressOn("Hero Card-1", "ArrowRight");
    const during = moves.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(300));
    expect({ during, moves: moves.mock.calls, now: positions()["Hero Card-1"] }).toMatchInlineSnapshot(`
      {
        "during": 0,
        "moves": [
          [
            [
              {
                "componentName": "Hero Card",
                "from": {
                  "x": 410,
                  "y": 20,
                },
                "to": {
                  "x": 432,
                  "y": 24,
                },
              },
            ],
          ],
        ],
        "now": "translate(432px,24px)",
      }
    `);
  } finally {
    vi.useRealTimers();
  }
});

it("moves frames for the host, and saves it, without calling it the user's move", async () => {
  vi.useFakeTimers();
  try {
    const onLayoutsChange = vi.fn();
    const { controls } = await withControls({}, onLayoutsChange);
    const moves = vi.fn();
    controls.onFramesMoved(moves);
    await act(async () => controls.moveFrames([{ componentName: "Card", x: 800, y: 800 }, { componentName: "Gone", x: 0, y: 0 }]));
    await act(async () => vi.advanceTimersByTime(500));
    expect({
      at: positions()["Card-1"],
      saved: onLayoutsChange.mock.calls.at(-1)?.[0][0],
      moves: moves.mock.calls.length,
    }).toMatchInlineSnapshot(`
      {
        "at": "translate(800px,800px)",
        "moves": 0,
        "saved": {
          "componentName": "Card",
          "height": 200,
          "width": 300,
          "x": 800,
          "y": 800,
        },
      }
    `);
  } finally {
    vi.useRealTimers();
  }
});

it("leaves a selected frame on the canvas on Backspace: deleting one is the host's", async () => {
  await renderCanvas();
  await pressOn("Card-1", "Enter");
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
  });
  expect(Object.keys(positions())).toEqual(["Card-1", "Hero Card-1"]);
});

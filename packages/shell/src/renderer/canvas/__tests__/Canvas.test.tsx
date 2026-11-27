// @vitest-environment jsdom
import { act, StrictMode, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { afterEach, beforeAll, expect, it, onTestFinished, vi } from "vitest";
import type { FrameLayer, FrameLayout } from "../Canvas";

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
  // The size menu's (@ui-sdk) waits for its animations.
  Element.prototype.getAnimations = () => [];
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
    sizeMenu = false,
    children,
  }: {
    components?: { name: string }[];
    savedLayouts?: FrameLayout[];
    strict?: boolean;
    sizeMenu?: boolean | { Covers?: ComponentType };
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
              sizeMenu={sizeMenu}
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

const postContentHeight = (height: number, componentName = "Card", origin = SITE) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { type: "component-content-size", componentName, height },
      }),
    );
  });

it("sizes a frame no bigger than 3840 a side from what its component reports, but keeps a bigger size the user set", async () => {
  await renderCanvas(undefined, undefined, {
    components: [{ name: "Card" }, { name: "Hero Card" }, { name: "Footer" }],
    savedLayouts: [
      { componentName: "Card", x: 0, y: 0, width: 300, height: 200 },
      { componentName: "Hero Card", x: 900, y: 0, width: 390, height: 600, sized: true, autoHeight: true },
      { componentName: "Footer", x: 2000, y: 0, width: 5000, height: 9000, sized: true },
    ],
  });
  await postSize(SITE, 6000, 25000);
  await postContentHeight(30000, "Hero Card");
  await postSize(SITE, 6000, 25000, "Footer");
  expect(frames().map((f) => `${f.node}: ${f.size}`)).toMatchInlineSnapshot(`
    [
      "Card-1: 3840px × 3840px",
      "Hero Card-1: 390px × 3840px",
      "Footer-1: 5000px × 9000px",
    ]
  `);
});

it("keeps a size set in the size menu, and has an Auto height follow its content", async () => {
  await renderCanvas(undefined, undefined, {
    components: [{ name: "Card" }, { name: "Hero Card" }],
    savedLayouts: [
      { componentName: "Card", x: 0, y: 0, width: 768, height: 1024, sized: true },
      { componentName: "Hero Card", x: 900, y: 0, width: 390, height: 600, sized: true, autoHeight: true },
    ],
  });
  const sizes = () => frames().map((f) => f.size);
  // The component's own size: a set size keeps it; Auto takes its height.
  await postSize(SITE, 500, 300);
  await postSize(SITE, 500, 700, "Hero Card");
  const afterComponentSize = sizes();
  // Its content's height, as it changes: only Auto follows it, and only from
  // the frames' origin.
  await postContentHeight(1500);
  await postContentHeight(950, "Hero Card");
  await postContentHeight(2000, "Hero Card", "https://elsewhere.test");
  expect({ afterComponentSize, afterContentHeight: sizes() }).toMatchInlineSnapshot(`
    {
      "afterComponentSize": [
        "768px × 1024px",
        "390px × 700px",
      ],
      "afterContentHeight": [
        "768px × 1024px",
        "390px × 950px",
      ],
    }
  `);
});

it("sizes a frame from its toolbar's size menu, and saves the size as set", async () => {
  vi.useFakeTimers();
  const saved = vi.fn();
  await renderCanvas(saved, undefined, { sizeMenu: true });
  const node = () => document.querySelector<HTMLElement>('.react-flow__node[data-id="Card-1"]')!;
  await act(async () => {
    node().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Frame size"]');
  const label = trigger()?.getAttribute("aria-label");
  await act(async () => trigger()!.click());
  const tablet = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
    o.textContent?.includes("Tablet"),
  )!;
  // Arrows in the menu move its highlight, not the frame.
  const at = positions()["Card-1"];
  await act(async () => {
    tablet.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(positions()["Card-1"]).toBe(at);
  await act(async () => tablet.click());
  await act(async () => vi.advanceTimersByTime(600));
  vi.useRealTimers();
  expect({
    before: label,
    after: trigger()?.getAttribute("aria-label"),
    size: frames()[0]!.size,
    saved: saved.mock.calls.at(-1)?.[0][0],
  }).toMatchInlineSnapshot(`
    {
      "after": "Frame size: Tablet, 768 × 1024",
      "before": "Frame size: Custom, 300 × 200",
      "saved": {
        "componentName": "Card",
        "height": 1024,
        "sized": true,
        "width": 768,
        "x": 10,
        "y": 20,
      },
      "size": "768px × 1024px",
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

// React Flow's own store, for a test that sends the changes NodeResizer
// sends while the user drags a frame's edge.
const flow: { store?: ReturnType<typeof useStoreApi> } = {};
const CatchStore = () => {
  flow.store = useStoreApi();
  return null;
};
// A drag of a frame's edge, as NodeResizer reports it: both sides on each
// move, and its height as the drag began on a drag of the side edge.
const resize = (id: string, width: number, height: number, resizing: boolean) =>
  act(() => {
    flow.store!.getState().triggerNodeChanges([
      { id, type: "dimensions", dimensions: { width, height }, resizing, setAttributes: true },
    ]);
  });
const savedOf = (saved: ReturnType<typeof vi.fn>, componentName: string) =>
  (saved.mock.calls.at(-1)?.[0] as FrameLayout[] | undefined)?.find((l) => l.componentName === componentName);

it("keeps an Auto height through a drag of the frame's side edge, at its content's height, and drops it for a drag of its height", async () => {
  vi.useFakeTimers();
  const saved = vi.fn();
  await renderCanvas(saved, undefined, {
    components: [{ name: "Card" }, { name: "Hero Card" }],
    savedLayouts: [
      { componentName: "Card", x: 0, y: 0, width: 390, height: 1800, sized: true, autoHeight: true },
      { componentName: "Hero Card", x: 900, y: 0, width: 390, height: 1800, sized: true, autoHeight: true },
    ],
    children: <CatchStore />,
  });
  // Card's right edge, dragged out: the page reflows shorter as it widens.
  await resize("Card-1", 800, 1800, true);
  await postContentHeight(1100);
  await resize("Card-1", 1280, 1800, true);
  await resize("Card-1", 1280, 1800, false);
  // Hero Card's bottom edge, dragged down.
  await resize("Hero Card-1", 390, 2000, true);
  await resize("Hero Card-1", 390, 2000, false);
  await act(async () => vi.advanceTimersByTime(600));
  vi.useRealTimers();
  expect({
    sizes: frames().map((f) => `${f.node}: ${f.size}`),
    card: savedOf(saved, "Card"),
    hero: savedOf(saved, "Hero Card"),
  }).toEqual({
    sizes: ["Card-1: 1280px × 1100px", "Hero Card-1: 390px × 2000px"],
    card: { componentName: "Card", x: 0, y: 0, width: 1280, height: 1100, sized: true, autoHeight: true },
    hero: { componentName: "Hero Card", x: 900, y: 0, width: 390, height: 2000, sized: true },
  });
});

it("stops an Auto height that its content's height goes with, where it is", async () => {
  vi.useFakeTimers();
  const saved = vi.fn();
  await renderCanvas(saved, undefined, {
    components: [{ name: "Card" }],
    savedLayouts: [{ componentName: "Card", x: 0, y: 0, width: 390, height: 908, sized: true, autoHeight: true }],
  });
  // min-h-screen under a 64px header: each height the frame takes, 64 more.
  await act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: SITE,
        data: { type: "component-content-size", componentName: "Card", height: 972, followsViewport: true },
      }),
    );
  });
  await act(async () => vi.advanceTimersByTime(600));
  vi.useRealTimers();
  expect({ size: frames()[0]!.size, saved: savedOf(saved, "Card") }).toEqual({
    size: "390px × 908px",
    saved: { componentName: "Card", x: 0, y: 0, width: 390, height: 908, sized: true },
  });
});

const select = (name: string) =>
  act(async () => {
    document
      .querySelector<HTMLElement>(`.react-flow__node[data-id="${name}-1"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const sizeTrigger = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Frame size"]')!;

it("says the canvas is covered while a frame's size menu is open, with the host's Covers", async () => {
  let covering = 0;
  const Covers = () => {
    covering++;
    return null;
  };
  await renderCanvas(undefined, undefined, { sizeMenu: { Covers } });
  await select("Card");
  const closed = covering;
  await act(async () => sizeTrigger().click());
  expect({ closed, open: covering > 0 }).toEqual({ closed: 0, open: true });
});

it("draws the size menu outside the canvas, so the keys pressed in it aren't the canvas's", async () => {
  // As in the app (Electron has the top layer): @ui-sdk draws a popover where
  // it's rendered, unless told where. Without the top layer (jsdom) it'd be
  // in <body> anyway.
  const proto = HTMLElement.prototype as { showPopover?: () => void; hidePopover?: () => void };
  proto.showPopover = function () {};
  proto.hidePopover = function () {};
  onTestFinished(() => {
    delete proto.showPopover;
    delete proto.hidePopover;
  });
  await renderCanvas(undefined, undefined, { sizeMenu: true });
  await select("Card");
  await act(async () => sizeTrigger().click());
  const menu = document.querySelector('[role="dialog"][aria-label="Frame size"]');
  expect({ shown: !!menu, inCanvas: !!menu?.closest(".react-flow") }).toEqual({ shown: true, inCanvas: false });
});

it("leaves the arrows pressed on a frame's toolbar to the toolbar, not moving the frame", async () => {
  await renderCanvas();
  await select("Card");
  const at = positions()["Card-1"];
  const button = document.querySelector<HTMLElement>('.canvas-frame-toolbar button[aria-label="Refresh"]')!;
  button.focus();
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  expect({ moved: positions()["Card-1"] !== at }).toEqual({ moved: false });
});

// The size menu's W field, as the user types in it.
const widthField = () => document.querySelector<HTMLInputElement>('input[aria-label="Width"]')!;
// Typed into a field, as a browser does: React reads the value through the
// input's own setter, not one set on the element.
const type = (field: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: text ? "insertText" : "deleteContentBackward" }));
  });
const key = (target: HTMLElement, k: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });

it("keeps the frame's width when Home or End is pressed in W, or a step is taken from W emptied", async () => {
  await renderCanvas(undefined, undefined, { sizeMenu: true });
  await select("Card");
  await act(async () => sizeTrigger().click());
  const field = widthField();
  await act(async () => field.focus());
  await key(field, "Home");
  await key(field, "End");
  const afterHomeEnd = frames()[0]!.size;
  // Emptied, then a step up.
  await type(field, "");
  await key(field, "ArrowUp");
  expect({ afterHomeEnd, afterStep: frames()[0]!.size }).toEqual({
    afterHomeEnd: "300px × 200px",
    afterStep: "300px × 200px",
  });
});

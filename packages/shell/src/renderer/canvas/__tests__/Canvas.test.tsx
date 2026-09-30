// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { FrameLayout } from "../Canvas";

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

async function renderCanvas(onLayoutsChange?: (layouts: FrameLayout[]) => void) {
  const { Canvas } = await import("../Canvas");
  const container = document.body.appendChild(document.createElement("div"));
  const render = (onChange: typeof onLayoutsChange) =>
    root!.render(
      <ReactFlowProvider>
        <div style={{ width: 1200, height: 800 }}>
          <Canvas
            components={[{ name: "Card" }, { name: "Hero Card" }]}
            savedLayouts={[{ componentName: "Card", x: 10, y: 20, width: 300, height: 200 }]}
            frameUrl={frameUrl}
            onLayoutsChange={onChange}
            onFullscreen={() => {}}
          />
        </div>
      </ReactFlowProvider>,
    );
  root = createRoot(container);
  await act(async () => render(onLayoutsChange));
  return { rerender: (onChange: typeof onLayoutsChange) => act(() => render(onChange)) };
}

const frames = () =>
  [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((node) => ({
    node: node.dataset.id,
    size: `${node.style.width} × ${node.style.height}`,
    src: node.querySelector("iframe")?.getAttribute("src"),
  }));

const postSize = (origin: string, width: number, height: number) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { type: "component-size", componentName: "Card", width, height },
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
                "x": 510,
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

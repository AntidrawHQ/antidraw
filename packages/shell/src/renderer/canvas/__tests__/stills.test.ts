// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { FrameStills, type CaptureArea } from "../stills";

// Which frames show a still while the canvas moves, and which stay live.

// A frame as the canvas has it: an iframe at `rect` on screen, laid out
// `width` by `height`, with its still's element over it.
const frame = (rect: { x: number; y: number; width: number; height: number }, layout = { width: 400, height: 300 }) => {
  const iframe = document.createElement("iframe");
  const canvas = document.createElement("canvas");
  canvas.style.visibility = "hidden";
  let size = layout;
  Object.defineProperty(iframe, "offsetWidth", { get: () => size.width });
  Object.defineProperty(iframe, "offsetHeight", { get: () => size.height });
  iframe.getBoundingClientRect = () => new DOMRect(rect.x, rect.y, rect.width, rect.height);
  document.body.append(iframe, canvas);
  return { iframe, canvas, resize: (to: typeof layout) => (size = to) };
};

const element = (rect: { x: number; y: number; width: number; height: number }) => {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => new DOMRect(rect.x, rect.y, rect.width, rect.height);
  return el;
};

// The canvas's area on screen, and a capture of it at two device pixels a CSS pixel.
const area = element({ x: 0, y: 0, width: 1000, height: 800 });
const capture: CaptureArea = async () => ({ width: 2000, height: 1600, close: () => {} }) as ImageBitmap;

const shown = (f: { iframe: HTMLIFrameElement; canvas: HTMLCanvasElement }) =>
  f.canvas.style.visibility === "visible" && f.iframe.style.visibility === "hidden" ? "still" : "live";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  vi.stubGlobal("devicePixelRatio", 2);
  // jsdom has no 2D context.
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never;
});

const canvasWith = (frames: Record<string, ReturnType<typeof frame>>) => {
  const stills = new FrameStills();
  for (const [name, f] of Object.entries(frames)) {
    stills.register(name, f.canvas);
    stills.setIframe(name, f.iframe);
  }
  return stills;
};

it("shows a still of each frame it has one of while the canvas moves, and the live frames again after", async () => {
  const frames = {
    OnScreen: frame({ x: 100, y: 100, width: 200, height: 150 }),
    HalfOffScreen: frame({ x: 900, y: 100, width: 200, height: 150 }),
    UnderAPanel: frame({ x: 100, y: 500, width: 200, height: 150 }),
  };
  const stills = canvasWith(frames);
  const panel = element({ x: 50, y: 600, width: 300, height: 100 });

  await stills.capture(area, [panel], capture);
  stills.hold(0.5);
  const moving = Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, shown(f)]));

  stills.release();
  vi.runAllTimers();
  const after = Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, shown(f)]));

  expect({ moving, after }).toMatchInlineSnapshot(`
    {
      "after": {
        "HalfOffScreen": "live",
        "OnScreen": "live",
        "UnderAPanel": "live",
      },
      "moving": {
        "HalfOffScreen": "live",
        "OnScreen": "still",
        "UnderAPanel": "live",
      },
    }
  `);
});

it("keeps a frame live when its still no longer fits it", async () => {
  const frames = {
    Resized: frame({ x: 100, y: 100, width: 200, height: 150 }),
    Focused: frame({ x: 400, y: 100, width: 200, height: 150 }),
    Unchanged: frame({ x: 700, y: 100, width: 200, height: 150 }),
  };
  const stills = canvasWith(frames);
  await stills.capture(area, [], capture);

  frames.Resized.resize({ width: 400, height: 900 });
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => frames.Focused.iframe });
  stills.hold(0.5);

  expect(Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, shown(f)]))).toEqual({
    Resized: "live",
    Focused: "live",
    Unchanged: "still",
  });
  Reflect.deleteProperty(document, "activeElement");
});

it("keeps a frame live when its still was taken from much further out", async () => {
  // 20px wide on screen when taken: 40 device pixels of a frame 400 wide.
  const frames = { Tiny: frame({ x: 100, y: 100, width: 20, height: 15 }) };
  const stills = canvasWith(frames);
  await stills.capture(area, [], capture);

  stills.hold(0.05);
  const farOut = shown(frames.Tiny);
  stills.release();
  vi.runAllTimers();
  stills.hold(1);

  expect({ farOut, closeUp: shown(frames.Tiny) }).toEqual({ farOut: "still", closeUp: "live" });
});

it("takes no stills while the canvas is moving", async () => {
  const frames = { OnScreen: frame({ x: 100, y: 100, width: 200, height: 150 }) };
  const stills = canvasWith(frames);
  const taken = vi.fn(capture);

  stills.hold(0.5);
  await stills.capture(area, [], taken);

  expect(taken).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A wheel over a frame window's overlay: the frame only scrolls while it
// turns, once per animation frame, and the overlay hears when it stops.

const scrolls: number[][] = [];
vi.mock("../bridge", async (actual) => ({
  ...(await actual<typeof import("../bridge")>()),
  scrollAt: (_frame: string, x: number, y: number, dx: number, dy: number) => void scrolls.push([x, y, dx, dy]),
}));
const { useFrameWheel } = await import("../frame-wheel");

let frames: FrameRequestCallback[];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => frames.push(fn));
  scrolls.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("scrolls once a frame while the wheel turns, says it's busy, and settles after", () => {
  let wheel!: ReturnType<typeof useFrameWheel>;
  const settled = vi.fn();
  const Probe = () => {
    wheel = useFrameWheel("Card", settled);
    return null;
  };
  document.body.innerHTML = `<div id="root"></div>`;
  const root = createRoot(document.getElementById("root")!);
  act(() => root.render(<Probe />));

  const turn = (y: number, dy: number, deltaMode = 0) => wheel.onWheel({ x: 10, y }, { deltaX: 0, deltaY: dy, deltaMode }, 800);
  turn(100, 4);
  turn(102, 6);
  // A mouse that counts lines.
  turn(104, 1, 1);
  expect([wheel.busy(), scrolls]).toEqual([true, []]);
  frames.splice(0).forEach((fn) => fn(0));
  expect(scrolls).toEqual([[10, 104, 0, 26]]);
  vi.advanceTimersByTime(100);
  expect([wheel.busy(), settled.mock.calls.length]).toEqual([true, 0]);
  vi.advanceTimersByTime(60);
  expect([wheel.busy(), settled.mock.calls.length]).toEqual([false, 1]);
  act(() => root.unmount());
});

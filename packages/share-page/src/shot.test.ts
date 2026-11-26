import { expect, it } from "vitest";
import { CAP_MS, QUIET_MS, SETTLE_MS, isShot, pictureOf, readyIn } from "./shot";

it("is a shot only when the URL says so", () => {
  expect(["", "?shot", "?shot=1", "?c=Card&shot=1", "?c=shot", "?shots=1"].map(isShot)).toEqual([
    false,
    true,
    true,
    true,
    false,
    false,
  ]);
});

it("waits for the frames to settle, and never past the cap", () => {
  const at = (rendered: number, sinceStart: number, sinceLast: number) =>
    readyIn({ total: 3, rendered, sinceStart, sinceLast });
  expect({
    "nothing heard yet": at(0, 0, 0),
    "one to go, just heard from another": at(2, 3000, 0),
    "one to go, quiet for a while": at(2, 9000, 6000),
    "one never reports": at(2, 10_000, QUIET_MS),
    "all rendered just now": at(3, 2000, 0),
    "all rendered, settled": at(3, 4000, SETTLE_MS),
    "still loading near the cap": at(1, CAP_MS - 500, 0),
    "past the cap": at(0, CAP_MS + 1, 100),
    "no frames at all": readyIn({ total: 0, rendered: 0, sinceStart: 0, sinceLast: 0 }),
  }).toMatchInlineSnapshot(`
    {
      "all rendered just now": 1000,
      "all rendered, settled": 0,
      "no frames at all": 1000,
      "nothing heard yet": 7000,
      "one never reports": 0,
      "one to go, just heard from another": 7000,
      "one to go, quiet for a while": 1000,
      "past the cap": 0,
      "still loading near the cap": 500,
    }
  `);
});

const PICTURE = { width: 1200, height: 630 };
const frame = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
// The view, and how much bigger than it the picture is.
const shown = (frames: ReturnType<typeof frame>[]) => {
  const view = pictureOf(frames, PICTURE);
  if (!view) return null;
  const round = (n: number) => Math.round(n);
  return { x: round(view.x), y: round(view.y), width: round(view.width), height: round(view.height) };
};

it("shows the whole of a canvas that fills the picture", () => {
  // A few posters in two rows.
  const posters = [frame(0, 0, 400, 520), frame(520, 40, 400, 520), frame(1040, 160, 400, 520), frame(40, 680, 400, 520), frame(560, 900, 400, 520)];
  const view = shown(posters)!;
  // Every frame is inside it, and it has the picture's shape.
  expect(posters.every((f) => f.x >= view.x && f.y >= view.y && f.x + f.width <= view.x + view.width && f.y + f.height <= view.y + view.height)).toBe(true);
  expect(view.width / view.height).toBeCloseTo(PICTURE.width / PICTURE.height, 1);
  // One frame alone is all of it too.
  const one = shown([frame(100, 100, 1440, 900)])!;
  expect(one.x).toBeLessThan(100);
  expect(one.x + one.width).toBeGreaterThan(1540);
});

it("shows the busiest part of a canvas too spread out to read whole", () => {
  // A long row of screens, and a small group far above it.
  const row = Array.from({ length: 30 }, (_, i) => frame(i * 1600, 6000, 1440, 900));
  const group = [frame(0, 0, 400, 300), frame(500, 0, 400, 300)];
  const view = shown([...group, ...row])!;
  // Starting at the row's first screen, a few of them across.
  expect(view.y).toBeGreaterThan(5000);
  expect(view.x).toBeLessThan(0);
  expect(view.width).toBeLessThan(1440 * 6);
  expect(view.width).toBeGreaterThanOrEqual(1440 * 2.5 - 1);

  // One page far taller than its neighbours: their tops, not all of its length.
  const pages = [frame(0, 0, 600, 1800), frame(700, 0, 600, 700), frame(1400, 0, 600, 700), frame(2100, 0, 600, 12_000)];
  const tops = shown(pages)!;
  expect(tops.y).toBeLessThanOrEqual(0);
  expect(tops.height).toBeLessThan(4000);
  expect(tops.x + tops.width).toBeGreaterThan(2000);
});

it("has nothing to show without frames", () => {
  expect(shown([])).toBeNull();
  expect(shown([frame(0, 0, 0, 0)])).toBeNull();
});

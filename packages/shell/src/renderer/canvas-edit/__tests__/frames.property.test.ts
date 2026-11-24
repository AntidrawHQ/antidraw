import fc from "fast-check";
import { expect, test } from "vitest";
import { CANVAS_GRID } from "@/renderer/canvas/grid";
import { isComponentName } from "@/shared/utils/component-name";
import { boundsOf, centredOn, copyName, offsetBy, PASTE_OFFSET } from "../frames";

// A paste's and a duplicate's names and places, whatever they're given.

// Names a canvas has: the words, spaces and digits copies are made of, in
// any case and order.
const name = fc
  .array(fc.constantFrom("Card", "Hero", "Copy", "copy", "COPY", " ", "2", "10", "a", "é", "-"), { minLength: 1, maxLength: 6 })
  .map((parts) => parts.join(""))
  .filter((n) => isComponentName(n) && n.trim() === n && n.length > 0);

test("a copy's name is never one taken, in any case, and is a name a file can have", () => {
  fc.assert(
    fc.property(name, fc.array(name, { maxLength: 8 }), fc.boolean(), (original, others, originalTaken) => {
      const taken = new Set([...others, ...(originalTaken ? [original] : [])].map((n) => n.toLowerCase()));
      const before = new Set(taken);
      const copy = copyName(original, taken);
      expect(before.has(copy.toLowerCase())).toBe(false);
      expect(taken.has(copy.toLowerCase())).toBe(true);
      expect(isComponentName(copy)).toBe(true);
      // Asked only for a taken name (a paste's, a duplicate's), it's never that name.
      if (originalTaken) expect(copy).not.toBe(original);
    }),
    { numRuns: 500 },
  );
});

test("a batch's copies all differ, even of one frame many times", () => {
  fc.assert(
    fc.property(fc.array(name, { minLength: 1, maxLength: 10 }), (names) => {
      const taken = new Set(names.map((n) => n.toLowerCase()));
      const copies = names.map((n) => copyName(n, taken).toLowerCase());
      expect(new Set(copies).size).toBe(copies.length);
    }),
  );
});

// Frames as the canvas has them: anywhere, any size a component reports.
const layout = fc.record({
  componentName: fc.constantFrom("A", "B", "C"),
  x: fc.integer({ min: -100_000, max: 100_000 }),
  y: fc.integer({ min: -100_000, max: 100_000 }),
  width: fc.double({ min: 10, max: 5000, noNaN: true }),
  height: fc.double({ min: 10, max: 5000, noNaN: true }),
});
const layouts = fc.array(layout, { minLength: 1, maxLength: 6 });

const onGrid = (n: number) => n % CANVAS_GRID === 0;
// Each frame's place relative to the first's, and its size.
const shape = (ls: { x: number; y: number; width: number; height: number }[]) =>
  ls.map((l) => ({ dx: l.x - ls[0]!.x, dy: l.y - ls[0]!.y, width: l.width, height: l.height }));

test("centred on a point, frames keep their shape, their corner on the grid, their middle at the point", () => {
  fc.assert(
    fc.property(layouts, fc.integer({ min: -100_000, max: 100_000 }), fc.integer({ min: -100_000, max: 100_000 }), (ls, x, y) => {
      const placed = centredOn(ls, { x, y });
      const bounds = boundsOf(placed);
      expect(shape(placed)).toEqual(shape(ls));
      expect(placed.map((l) => l.componentName)).toEqual(ls.map((l) => l.componentName));
      expect(onGrid(bounds.x) && onGrid(bounds.y)).toBe(true);
      // Snapping the corner moves the middle by at most half a step.
      expect(Math.abs(bounds.x + bounds.width / 2 - x)).toBeLessThanOrEqual(CANVAS_GRID / 2 + 1e-6);
      expect(Math.abs(bounds.y + bounds.height / 2 - y)).toBeLessThanOrEqual(CANVAS_GRID / 2 + 1e-6);
    }),
    { numRuns: 500 },
  );
});

test("offset, frames keep their shape and land each step further on, on the grid", () => {
  fc.assert(
    fc.property(layouts, fc.integer({ min: 1, max: 20 }), (ls, steps) => {
      const placed = offsetBy(ls, steps);
      const was = boundsOf(ls);
      const now = boundsOf(placed);
      expect(shape(placed)).toEqual(shape(ls));
      expect(onGrid(now.x) && onGrid(now.y)).toBe(true);
      expect(Math.abs(now.x - (was.x + PASTE_OFFSET * steps))).toBeLessThanOrEqual(CANVAS_GRID / 2);
      expect(Math.abs(now.y - (was.y + PASTE_OFFSET * steps))).toBeLessThanOrEqual(CANVAS_GRID / 2);
    }),
    { numRuns: 500 },
  );
});

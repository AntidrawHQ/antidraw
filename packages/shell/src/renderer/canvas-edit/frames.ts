import type { FrameLayout } from "@/renderer/canvas/Canvas";
import { CANVAS_GRID, snapToCanvasGrid } from "@/renderer/canvas/grid";

// The names and places of the frames a paste or a duplicate makes.

// A copy's name, as its file's: Card → CardCopy → CardCopy2, and with the
// spaces a spaced name has, Hero Card → Hero Card Copy → Hero Card Copy 2.
// A copy of a copy counts on from it. `taken` is lower case (macOS's file
// system ignores case) and gets the name, so a batch's names differ too.
// For a name that's taken: a free one can come back as it is (CardCopy).
export const copyName = (name: string, taken: Set<string>) => {
  const spaced = /\s/.test(name);
  const base = (spaced ? name.replace(/\sCopy(\s\d+)?$/, "") : name.replace(/Copy\d*$/, "")) || name;
  for (let n = 1; ; n++) {
    const candidate = spaced
      ? `${base} Copy${n === 1 ? "" : ` ${n}`}`
      : `${base}Copy${n === 1 ? "" : n}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
};

type Box = { x: number; y: number; width: number; height: number };

export const boundsOf = (layouts: FrameLayout[]): Box => {
  const left = Math.min(...layouts.map((l) => l.x));
  const top = Math.min(...layouts.map((l) => l.y));
  const right = Math.max(...layouts.map((l) => l.x + l.width));
  const bottom = Math.max(...layouts.map((l) => l.y + l.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

// The frames moved together, apart as they were, their corner on the grid.
const moveTo = (layouts: FrameLayout[], corner: { x: number; y: number }) => {
  const bounds = boundsOf(layouts);
  const dx = snapToCanvasGrid(corner.x) - bounds.x;
  const dy = snapToCanvasGrid(corner.y) - bounds.y;
  return layouts.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
};

// How far each paste of the same frames, or a duplicate, lands from the last.
export const PASTE_OFFSET = CANVAS_GRID * 5;

// Centred on a point: the pointer's, on the canvas.
export const centredOn = (layouts: FrameLayout[], point: { x: number; y: number }) => {
  const bounds = boundsOf(layouts);
  return moveTo(layouts, { x: point.x - bounds.width / 2, y: point.y - bounds.height / 2 });
};

// Down and to the right of where they were, by `steps` offsets.
export const offsetBy = (layouts: FrameLayout[], steps: number) => {
  const bounds = boundsOf(layouts);
  return moveTo(layouts, { x: bounds.x + PASTE_OFFSET * steps, y: bounds.y + PASTE_OFFSET * steps });
};

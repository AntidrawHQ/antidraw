// A snapshot's components as a list, for screens that can't show the canvas
// (app/touch): which comes after which, how big each is, and which one the
// URL has open.

// The parts of canvas.json this reads (the shell's CanvasFile has them).
// Spelled out here so the tests, which run without the shell's sources, can
// load this file.
type Layout = { componentName: string; x: number; y: number; width: number; height: number };
type Snapshot = { components: { name: string }[]; layouts: Layout[] };

export type Frame = {
  name: string;
  width: number;
  height: number;
  /** False when canvas.json has no size of its own for it. */
  sized: boolean;
};

// What the canvas gives a frame nobody has sized (Canvas.tsx's
// NEW_FRAME_SIZE). A layout that still has it says nothing about the
// component.
const UNSIZED = { width: 400, height: 300 };

/**
 * The components in the order the canvas reads: rows from the top, each from
 * its left. A frame is in a row when it starts above the middle of the row's
 * first frame, so frames set side by side at slightly different heights stay
 * together. Components the canvas hasn't placed come last, as canvas.json
 * lists them.
 */
export const framesInReadingOrder = (file: Snapshot): Frame[] => {
  const known = new Set(file.components.map((component) => component.name));
  const placed = new Map(
    file.layouts.filter((layout) => known.has(layout.componentName)).map((layout) => [layout.componentName, layout]),
  );

  const rows: { top: number; height: number; layouts: Layout[] }[] = [];
  for (const layout of [...placed.values()].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && layout.y < row.top + row.height / 2) row.layouts.push(layout);
    else rows.push({ top: layout.y, height: layout.height, layouts: [layout] });
  }

  const ordered = rows.flatMap((row) =>
    row.layouts
      .sort((a, b) => a.x - b.x)
      .map(({ componentName, width, height }): Frame => {
        const sized = width > 0 && height > 0 && !(width === UNSIZED.width && height === UNSIZED.height);
        return sized
          ? { name: componentName, width, height, sized }
          : { name: componentName, ...UNSIZED, sized: false };
      }),
  );
  const unplaced = file.components
    .filter((component) => !placed.has(component.name))
    .map((component): Frame => ({ name: component.name, ...UNSIZED, sized: false }));
  return [...ordered, ...unplaced];
};

/** How much a frame is scaled to fit a box's width. Never enlarged. */
export const fitScale = (frameWidth: number, boxWidth: number) =>
  frameWidth > 0 && boxWidth > 0 ? Math.min(1, boxWidth / frameWidth) : 1;

// The open component is in the URL (?c=<name>), so the browser's back returns
// to the list and a link can point at one component. Only the list reads it:
// the canvas opens on all of them whatever the URL says.
const PARAM = "c";

/** The component a URL's query names, or null when it names none. */
export const openName = (search: string): string | null => new URLSearchParams(search).get(PARAM);

/** Which frame a URL's query has open, or null for the list. */
export const openFrame = (search: string, frames: Frame[]): number | null => {
  const name = openName(search);
  if (name === null) return null;
  const index = frames.findIndex((frame) => frame.name === name);
  return index === -1 ? null : index;
};

/** The query with a frame open, or with none (null); other parameters are kept. */
export const searchWith = (search: string, name: string | null) => {
  const params = new URLSearchParams(search);
  if (name === null) params.delete(PARAM);
  else params.set(PARAM, name);
  const query = params.toString();
  return query ? `?${query}` : "";
};

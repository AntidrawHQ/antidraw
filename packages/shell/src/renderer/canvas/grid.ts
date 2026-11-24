// Dragged frames snap to it, and so do the ones the shell places (a paste).
// The row the canvas lines new frames up in doesn't: it's level with frames
// saved before there was a grid.
export const CANVAS_GRID = 8;
export const snapToCanvasGrid = (n: number) => Math.round(n / CANVAS_GRID) * CANVAS_GRID;

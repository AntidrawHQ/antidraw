import type { FrameLayout } from "./Canvas";

// canvas.json, published next to a workspace's built components: what the
// shell's canvas would show, frozen at publish time. The share page
// (@antidraw/share-page) reads it from the site and draws the canvas.
export type CanvasFile = {
  version: 1;
  name: string;
  components: { name: string }[];
  layouts: FrameLayout[];
};

// A frame as canvas.json has it: its place and size, and whether the size was
// set in its size menu (sized) and its height is Auto, only when they are, so
// canvas.json is as it was for frames nobody sized. Without them, the share
// page's canvas would size every frame from what its component reports.
export const canvasLayout = ({ componentName, x, y, width, height, sized, autoHeight }: FrameLayout): FrameLayout => ({
  componentName,
  x,
  y,
  width,
  height,
  ...(sized && { sized: true }),
  ...(autoHeight && { autoHeight: true }),
});

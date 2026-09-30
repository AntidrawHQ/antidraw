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

import type { FrameLayout } from "@/renderer/canvas/Canvas";

// canvas.json, written next to the viewer when a workspace is published: what
// the shell's canvas would show, frozen at publish time.
export type CanvasFile = {
  version: 1;
  name: string;
  components: { name: string }[];
  layouts: FrameLayout[];
};

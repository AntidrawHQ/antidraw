import { create } from "zustand";
import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { useInspectorStore } from "../inspector/store";
import { useWorkspaceStore } from "../store/workspace";

// The Comment tool's state on the canvas: whether it's on, the box a click
// opened, the comment opened from its row or pin, and the pin a row lights.
// The comments themselves are server state (lib/comment-ops).

// Where a pin is: in the frame's CSS pixels, from its top left.
export type Pos = { x: number; y: number };

export type Box = { frame: string; pos: Pos; element: ElementInfo | null };

type CommentStore = {
  active: boolean;
  box: Box | null;
  opened: { id: number; edit: boolean } | null;
  lit: number | null;
  // Whether a frame is on the canvas: the canvas's (CommentFlow) while it's
  // up, and with none up, none is.
  onCanvas: (frame: string) => boolean;
  setActive: (active: boolean) => void;
  setBox: (box: Box | null) => void;
  setOpened: (opened: { id: number; edit: boolean } | null) => void;
  setLit: (lit: number | null) => void;
};

const closed = { box: null, opened: null, lit: null };

export const useCommentStore = create<CommentStore>((set) => ({
  active: false,
  ...closed,
  onCanvas: () => false,
  setActive: (active) => set(active ? { active } : { active, ...closed }),
  setBox: (box) => set({ box }),
  setOpened: (opened) => set({ opened }),
  setLit: (lit) => set({ lit }),
}));

useWorkspaceStore.subscribe((s, prev) => {
  if (s.activeWorkspaceId !== prev.activeWorkspaceId) useCommentStore.setState(closed);
});

// The canvas's tools are one at a time: Pointer, Inspect or Comment.
export type CanvasTool = "pointer" | "inspect" | "comment";

export const useCanvasTool = (): CanvasTool => {
  const inspecting = useInspectorStore((s) => s.active);
  const commenting = useCommentStore((s) => s.active);
  return inspecting ? "inspect" : commenting ? "comment" : "pointer";
};

export const setCanvasTool = (tool: CanvasTool) => {
  useInspectorStore.getState().setActive(tool === "inspect");
  useCommentStore.getState().setActive(tool === "comment");
};

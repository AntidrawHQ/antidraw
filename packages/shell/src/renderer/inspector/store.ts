import { create } from "zustand";
import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { useWorkspaceStore } from "../store/workspace";

// What the canvas inspector knows: which frames can answer it, the element
// under the pointer, the selected one, and the elements tagged for the next
// chat message. The frames themselves are reached through ./bridge.

// An element in a frame, as the frame last described it.
export type Picked = { frame: string; info: ElementInfo };

export type FrameStatus = {
  // Its runtime answered: it has an inspector.
  ready: boolean;
  // Its elements carry source locations (the dev server's Vite plugin).
  tagged: boolean;
};

type InspectorStore = {
  active: boolean;
  frames: Record<string, FrameStatus>;
  hover: Picked | null;
  selection: Picked | null;
  tags: Picked[];
  setActive: (active: boolean) => void;
  setFrame: (frame: string, status: FrameStatus | null) => void;
  setHover: (hover: Picked | null) => void;
  setSelection: (selection: Picked | null) => void;
  addTag: (tag: Picked) => void;
  removeTag: (tag: Picked) => void;
  setTags: (tags: Picked[]) => void;
};

// Two picks name the same element when the frame would find the same one.
export const samePick = (a: Picked, b: Picked) =>
  a.frame === b.frame &&
  a.info.ref.loc === b.info.ref.loc &&
  a.info.ref.index === b.info.ref.index &&
  (a.info.ref.loc !== null || a.info.ref.path.join() === b.info.ref.path.join());

export const useInspectorStore = create<InspectorStore>((set) => ({
  active: false,
  frames: {},
  hover: null,
  selection: null,
  tags: [],
  setActive: (active) => set(active ? { active } : { active, hover: null }),
  setFrame: (frame, status) =>
    set((s) => {
      const frames = { ...s.frames };
      if (status) frames[frame] = status;
      else delete frames[frame];
      return { frames };
    }),
  setHover: (hover) => set({ hover }),
  setSelection: (selection) => set({ selection }),
  addTag: (tag) =>
    set((s) => (s.tags.some((t) => samePick(t, tag)) ? s : { tags: [...s.tags, tag] })),
  removeTag: (tag) => set((s) => ({ tags: s.tags.filter((t) => t !== tag) })),
  setTags: (tags) => set({ tags }),
}));

// Picks name elements by component name and source location, which mean
// something else in another workspace: switching drops them.
useWorkspaceStore.subscribe((s, prev) => {
  if (s.activeWorkspaceId !== prev.activeWorkspaceId)
    useInspectorStore.setState({ hover: null, selection: null, tags: [] });
});

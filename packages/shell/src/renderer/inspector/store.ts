import { create } from "zustand";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import { useWorkspaceStore } from "../store/workspace";

// What the canvas inspector knows: which frames can answer it, the selected
// element, and the elements tagged for the next chat message. The frames
// themselves are reached through ./bridge.

// An element in a frame, as the frame last described it. A tag also has
// what its frame said about it when it was tagged (`seen`, null if it
// couldn't say), and goes to Claude as that, whatever the page does after.
export type Picked = { frame: string; info: ElementInfo; seen?: ElementContext | null };

export type FrameStatus = {
  // Its runtime answered: it has an inspector.
  ready: boolean;
  // Its elements carry source locations (the dev server's Vite plugin).
  tagged: boolean;
  // Its answer came from the page's root standing in, before the component's
  // element was there: the real one follows.
  provisional?: boolean;
};

type InspectorStore = {
  active: boolean;
  frames: Record<string, FrameStatus>;
  selection: Picked | null;
  tags: Picked[];
  // Per frame, the design previews it can't find an element for, by key
  // (bridge's previewStyles).
  missing: Record<string, string[]>;
  setActive: (active: boolean) => void;
  setFrame: (frame: string, status: FrameStatus | null) => void;
  setSelection: (selection: Picked | null) => void;
  addTag: (tag: Picked) => void;
  removeTag: (tag: Picked) => void;
  setTags: (tags: Picked[]) => void;
  setMissing: (frame: string, keys: string[] | null) => void;
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
  selection: null,
  tags: [],
  missing: {},
  setActive: (active) => set({ active }),
  setFrame: (frame, status) =>
    set((s) => {
      const frames = { ...s.frames };
      if (status) frames[frame] = status;
      else delete frames[frame];
      return { frames };
    }),
  setSelection: (selection) => set({ selection }),
  addTag: (tag) =>
    set((s) => (s.tags.some((t) => samePick(t, tag)) ? s : { tags: [...s.tags, tag] })),
  removeTag: (tag) => set((s) => ({ tags: s.tags.filter((t) => t !== tag) })),
  setTags: (tags) => set({ tags }),
  setMissing: (frame, keys) =>
    set((s) => {
      const missing = { ...s.missing };
      if (keys) missing[frame] = keys;
      else delete missing[frame];
      return { missing };
    }),
}));

// Picks name elements by component name and source location, which mean
// something else in another workspace: switching drops them.
useWorkspaceStore.subscribe((s, prev) => {
  if (s.activeWorkspaceId !== prev.activeWorkspaceId)
    useInspectorStore.setState({ selection: null, tags: [] });
});

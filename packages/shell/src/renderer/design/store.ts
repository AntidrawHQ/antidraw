import { create } from "zustand";
import type { ElementContext } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import { useCommentStore } from "@/renderer/comments/store";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useWorkspaceStore } from "@/renderer/store/workspace";

// The right panel's own state: whether it's open, how wide, the section it
// shows, and the selected element as its frame showed it when picked. The
// edits themselves are server state (lib/edit-ops).

export type Tab = "design" | "comments";

// The selected element before any edit of it: its styles, whether text is
// written in it, and what its frame said about it (null if it couldn't). An
// edit starts from this, and hands Claude `seen`.
export type Read = { key: string; style: Style; text: boolean; seen: ElementContext | null };

// The panel's width, dragged by its left edge.
export const PANEL_W = { min: 256, max: 480 };

type DesignStore = {
  panelOpen: boolean;
  width: number;
  tab: Tab;
  read: Read | null;
  setPanelOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  setTab: (tab: Tab) => void;
  setRead: (read: Read | null) => void;
};

export const useDesignStore = create<DesignStore>((set) => ({
  panelOpen: true,
  width: PANEL_W.min,
  tab: "design",
  read: null,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setWidth: (width) => set({ width: Math.round(Math.min(PANEL_W.max, Math.max(PANEL_W.min, width))) }),
  setTab: (tab) => set({ tab }),
  setRead: (read) => set({ read }),
}));

// Picking Inspect or Comment opens its section. A tab picked in the panel
// leaves the tool as it is.
useInspectorStore.subscribe((s, prev) => {
  if (s.active && !prev.active) useDesignStore.getState().setTab("design");
});
useCommentStore.subscribe((s, prev) => {
  if (s.active && !prev.active) useDesignStore.getState().setTab("comments");
});

useWorkspaceStore.subscribe((s, prev) => {
  if (s.activeWorkspaceId !== prev.activeWorkspaceId) useDesignStore.setState({ read: null });
});

export const useTab = (): Tab => useDesignStore((s) => s.tab);

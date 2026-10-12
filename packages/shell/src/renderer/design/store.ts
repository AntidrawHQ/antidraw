import { create } from "zustand";
import type { ElementContext } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import { useCanvasTool, useCommentStore } from "@/renderer/comments/store";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useWorkspaceStore } from "@/renderer/store/workspace";

// The right panel's own state: whether it's open, the section Pointer
// keeps, and the selected element as its frame showed it when picked. The
// edits themselves are server state (lib/edit-ops).

export type Tab = "design" | "comments";

// The selected element before any edit of it: its styles, whether text is
// written in it, and what its frame said about it (null if it couldn't). An
// edit starts from this, and hands Claude `seen`.
export type Read = { key: string; style: Style; text: boolean; seen: ElementContext | null };

type DesignStore = {
  panelOpen: boolean;
  lastTab: Tab;
  read: Read | null;
  setPanelOpen: (open: boolean) => void;
  setLastTab: (tab: Tab) => void;
  setRead: (read: Read | null) => void;
};

export const useDesignStore = create<DesignStore>((set) => ({
  panelOpen: true,
  lastTab: "design",
  read: null,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setLastTab: (lastTab) => set({ lastTab }),
  setRead: (read) => set({ read }),
}));

// Inspect and Comment each open their section, which Pointer then keeps.
useInspectorStore.subscribe((s, prev) => {
  if (s.active && !prev.active) useDesignStore.getState().setLastTab("design");
});
useCommentStore.subscribe((s, prev) => {
  if (s.active && !prev.active) useDesignStore.getState().setLastTab("comments");
});

useWorkspaceStore.subscribe((s, prev) => {
  if (s.activeWorkspaceId !== prev.activeWorkspaceId) useDesignStore.setState({ read: null });
});

// The tool picks the section: Inspect → Design, Comment → Comments, Pointer
// keeps the last.
export const useTab = (): Tab => {
  const tool = useCanvasTool();
  const lastTab = useDesignStore((s) => s.lastTab);
  return tool === "comment" ? "comments" : tool === "inspect" ? "design" : lastTab;
};

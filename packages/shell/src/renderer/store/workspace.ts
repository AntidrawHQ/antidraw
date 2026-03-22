import { create } from "zustand";

export type SidePanel = "chat" | "components";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeSidePanel: SidePanel;
  setActiveSidePanel: (panel: SidePanel) => void;
  focusComponentName: string | null;
  setFocusComponentName: (name: string | null) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  activeSidePanel: "chat",
  setActiveSidePanel: (panel) => set({ activeSidePanel: panel }),
  focusComponentName: null,
  setFocusComponentName: (name) => set({ focusComponentName: name }),
}));

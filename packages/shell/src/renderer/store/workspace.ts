import { create } from "zustand";

export type SidePanel = "chat" | "components";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeSidePanel: SidePanel;
  setActiveSidePanel: (panel: SidePanel) => void;
  // Folded away with Mod+B; picking a panel unfolds it.
  sidePanelOpen: boolean;
  toggleSidePanel: () => void;
  focusComponentName: string | null;
  setFocusComponentName: (name: string | null) => void;
  codePanelComponentName: string | null;
  setCodePanelComponentName: (name: string | null) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  activeSidePanel: "chat",
  setActiveSidePanel: (panel) => set({ activeSidePanel: panel, sidePanelOpen: true }),
  sidePanelOpen: true,
  toggleSidePanel: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
  focusComponentName: null,
  setFocusComponentName: (name) => set({ focusComponentName: name }),
  codePanelComponentName: null,
  setCodePanelComponentName: (name) => set({ codePanelComponentName: name }),
}));

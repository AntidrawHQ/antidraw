import { create } from "zustand";

export type SidePanel = "chat" | "components";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  // Shows a conversation in the chat panel from outside it (a comment set's
  // Open), even over the panel's chat list. `conversationShown` counts the
  // requests: the panel closes its list on each.
  showConversation: (id: string) => void;
  conversationShown: number;
  activeSidePanel: SidePanel;
  setActiveSidePanel: (panel: SidePanel) => void;
  // Folded away with Mod+B; picking a panel unfolds it.
  sidePanelOpen: boolean;
  toggleSidePanel: () => void;
  // Mod+\ hides the chrome around the canvas, as Figma's Show/Hide UI: the
  // icon strip, the side panel, the right panel and the tool rail. Each keeps
  // its own open or folded state under it, and is as it was when shown again.
  uiHidden: boolean;
  setUiHidden: (hidden: boolean) => void;
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
  showConversation: (id) =>
    set((s) => ({
      activeConversationId: id,
      activeSidePanel: "chat",
      sidePanelOpen: true,
      uiHidden: false,
      conversationShown: s.conversationShown + 1,
    })),
  conversationShown: 0,
  activeSidePanel: "chat",
  setActiveSidePanel: (panel) => set({ activeSidePanel: panel, sidePanelOpen: true, uiHidden: false }),
  sidePanelOpen: true,
  // With the chrome hidden, Mod+B brings it back with the side panel open.
  toggleSidePanel: () =>
    set((s) => (s.uiHidden ? { uiHidden: false, sidePanelOpen: true } : { sidePanelOpen: !s.sidePanelOpen })),
  uiHidden: false,
  setUiHidden: (hidden) => set({ uiHidden: hidden }),
  focusComponentName: null,
  setFocusComponentName: (name) => set({ focusComponentName: name }),
  codePanelComponentName: null,
  setCodePanelComponentName: (name) => set({ codePanelComponentName: name }),
}));

import { create } from "zustand";
import type { PublishedSite } from "@/main/api";

export type SidePanel = "chat" | "components";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  // What the window's other tab holds when it isn't a workspace: a published
  // site, view-only (renderer/published). Never both: opening one closes the
  // other (lib/workspace-ops.ts).
  publishedSite: PublishedSite | null;
  setPublishedSite: (site: PublishedSite | null) => void;
  // The Dashboard tab is the one showing: the workspaces list, over what the
  // other tab holds, which keeps running under it.
  dashboardShown: boolean;
  setDashboardShown: (shown: boolean) => void;
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
  focusComponentName: string | null;
  setFocusComponentName: (name: string | null) => void;
  codePanelComponentName: string | null;
  setCodePanelComponentName: (name: string | null) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  publishedSite: null,
  setPublishedSite: (site) => set({ publishedSite: site }),
  dashboardShown: false,
  setDashboardShown: (shown) => set({ dashboardShown: shown }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  showConversation: (id) =>
    set((s) => ({
      activeConversationId: id,
      activeSidePanel: "chat",
      sidePanelOpen: true,
      conversationShown: s.conversationShown + 1,
    })),
  conversationShown: 0,
  activeSidePanel: "chat",
  setActiveSidePanel: (panel) => set({ activeSidePanel: panel, sidePanelOpen: true }),
  sidePanelOpen: true,
  toggleSidePanel: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
  focusComponentName: null,
  setFocusComponentName: (name) => set({ focusComponentName: name }),
  codePanelComponentName: null,
  setCodePanelComponentName: (name) => set({ codePanelComponentName: name }),
}));

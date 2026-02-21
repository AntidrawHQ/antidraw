import { create } from "zustand";

type SidePanel = "chat" | "components";

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

// TODO: Remove hardcoded defaults after workspace/conversation selectors are implemented
const TEMP_DEFAULT_WORKSPACE_ID = "eeeb64ff-bd78-4f80-91db-e05de40e4cb8";
const TEMP_DEFAULT_CONVERSATION_ID: string | null = null; // Set to a conversation ID to test loading existing conversations

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeWorkspaceId: TEMP_DEFAULT_WORKSPACE_ID,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  activeConversationId: TEMP_DEFAULT_CONVERSATION_ID,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  activeSidePanel: "chat",
  setActiveSidePanel: (panel) => set({ activeSidePanel: panel }),
  focusComponentName: null,
  setFocusComponentName: (name) => set({ focusComponentName: name }),
}));

// Expose store for console debugging in development
if (process.env.NODE_ENV === "development") {
  (window as unknown as { workspaceStore: typeof useWorkspaceStore }).workspaceStore = useWorkspaceStore;
}

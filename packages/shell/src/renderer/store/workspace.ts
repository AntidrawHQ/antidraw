import { create } from "zustand";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
}));

// Expose store for console debugging in development
if (process.env.NODE_ENV === "development") {
  (window as unknown as { workspaceStore: typeof useWorkspaceStore }).workspaceStore = useWorkspaceStore;
}

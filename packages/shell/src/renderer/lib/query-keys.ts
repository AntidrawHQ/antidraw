export const queryKeys = {
  claudeCode: {
    authStatus: ["claudeCode", "authStatus"] as const,
  },
  workspaces: {
    all: ["workspaces"] as const,
    detail: (id: string | null) => ["workspace", id] as const,
  },
  devServer: {
    status: (workspaceId: string | null) => ["devServer", workspaceId] as const,
  },
  conversations: {
    detail: (id: string | null) => ["conversation", id] as const,
    byWorkspace: (workspaceId: string | null) =>
      ["workspace-conversations", workspaceId] as const,
    livePartial: (id: string | null) =>
      ["conversation", id, "live-partial"] as const,
  },
  userComponents: {
    byWorkspace: (workspaceId: string) =>
      ["userComponents", workspaceId] as const,
    source: (workspaceId: string, componentName: string) =>
      ["userComponents", "source", workspaceId, componentName] as const,
  },
  preferences: {
    byKey: (key: string) => ["preferences", key] as const,
  },
  frameLayouts: {
    byWorkspace: (workspaceId: string | null) =>
      ["frameLayouts", workspaceId] as const,
  },
} as const;

export const queryKeys = {
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
  },
  userComponents: {
    byWorkspace: (workspaceId: string, port: number) =>
      ["userComponents", workspaceId, port] as const,
    source: (workspaceId: string, port: number, componentName: string) =>
      ["userComponents", "source", workspaceId, port, componentName] as const,
  },
} as const;

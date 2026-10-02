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
    livePartial: (id: string | null) =>
      ["conversation", id, "live-partial"] as const,
    // Renderer-only: userMessageIds sent mid-turn, not yet acked by the CLI.
    queuedMessageIds: (id: string | null) =>
      ["conversation", id, "queued-message-ids"] as const,
    // Renderer-only: how each send from this window went out, by
    // userMessageId — "queue" if made mid-turn, "direct" if not. See
    // useSendIntents.
    sendIntents: (id: string | null) =>
      ["conversation", id, "send-intents"] as const,
    // userMessageIds the CLI never received, as the backend computes them.
    failedMessageIds: (id: string | null) =>
      ["conversation", id, "failed-message-ids"] as const,
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
  models: {
    catalog: ["model-catalog"] as const,
  },
  frameLayouts: {
    byWorkspace: (workspaceId: string | null) =>
      ["frameLayouts", workspaceId] as const,
  },
} as const;

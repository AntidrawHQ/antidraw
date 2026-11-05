declare global {
  interface Window {
    electronAPI: {
      /** Sent on requests only the app's own pages may make (main/lib/app-key.ts). */
      appKey: string;
      openPreviewWindow: (url: string, workspaceId?: string) => Promise<void>;
      /** From a preview window: show a comment it added in the main window, and with `send`, send the drafts there. */
      showComments: (request: { workspaceId: string; commentId: number; send: boolean; chat?: string }) => Promise<void>;
      /** In the main window: a preview window's showComments. */
      onCommentsShown: (callback: (request: { workspaceId: string; commentId: number; send: boolean; chat?: string }) => void) => () => void;
      /** In the main window: saves what it shows at `rect` (CSS px) as the workspace's thumbnail. */
      captureThumbnail: (workspaceId: string, rect: { x: number; y: number; width: number; height: number }) => Promise<void>;
      /** A content-free analytics event; see renderer/lib/analytics.ts. */
      track: (event: string, properties?: Record<string, unknown>) => void;
      getUpdateStatus: () => Promise<{ pendingVersion: string | null }>;
      installUpdate: () => Promise<void>;
      onUpdateDownloaded: (callback: (version: string) => void) => () => void;
    };
  }
}

export {};

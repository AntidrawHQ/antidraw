import type { Picked } from "./inspector/store";

declare global {
  interface Window {
    electronAPI: {
      /** Sent on requests only the app's own pages may make (main/lib/app-key.ts). */
      appKey: string;
      openPreviewWindow: (url: string, workspaceId?: string) => Promise<void>;
      /** From a preview window: tags an element shown at `url` in the main window. */
      tagElement: (pick: Picked, url: string) => Promise<void>;
      /** In the main window: elements tagged in preview windows. */
      onElementTagged: (callback: (pick: Picked, url: string) => void) => () => void;
      /** From a preview window: show a comment it added in the main window, and with `send`, send the drafts there. */
      showComments: (request: { workspaceId: string; commentId: number; send: boolean }) => Promise<void>;
      /** In the main window: a preview window's showComments. */
      onCommentsShown: (callback: (request: { workspaceId: string; commentId: number; send: boolean }) => void) => () => void;
      getUpdateStatus: () => Promise<{ pendingVersion: string | null }>;
      installUpdate: () => Promise<void>;
      onUpdateDownloaded: (callback: (version: string) => void) => () => void;
    };
  }
}

export {};

declare global {
  interface Window {
    electronAPI: {
      /** Sent on requests only the app's own pages may make (main/lib/app-key.ts). */
      appKey: string;
      openPreviewWindow: (url: string) => Promise<void>;
      getUpdateStatus: () => Promise<{ pendingVersion: string | null }>;
      installUpdate: () => Promise<void>;
      onUpdateDownloaded: (callback: (version: string) => void) => () => void;
    };
  }
}

export {};

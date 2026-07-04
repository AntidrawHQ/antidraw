declare global {
  interface Window {
    electronAPI: {
      openPreviewWindow: (url: string) => Promise<void>;
      getUpdateStatus: () => Promise<{ pendingVersion: string | null }>;
      installUpdate: () => Promise<void>;
      onUpdateDownloaded: (callback: (version: string) => void) => () => void;
    };
  }
}

export {};

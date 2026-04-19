declare global {
  interface Window {
    electronAPI: {
      openPreviewWindow: (url: string) => Promise<void>;
    };
  }
}

export {};

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openPreviewWindow: (url: string) => ipcRenderer.invoke("open-preview-window", url),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateDownloaded: (callback: (version: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, version: string) =>
      callback(version);
    ipcRenderer.on("update:downloaded", listener);
    return () => ipcRenderer.removeListener("update:downloaded", listener);
  },
});

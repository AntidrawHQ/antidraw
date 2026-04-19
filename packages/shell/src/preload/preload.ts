import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openPreviewWindow: (url: string) => ipcRenderer.invoke("open-preview-window", url),
});

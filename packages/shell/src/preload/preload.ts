import { contextBridge, ipcRenderer } from "electron";

// main's per-launch key for this window (see main/lib/app-key.ts).
const APP_KEY_ARG = "--antidraw-app-key=";
const appKey = process.argv.find((arg) => arg.startsWith(APP_KEY_ARG))?.slice(APP_KEY_ARG.length) ?? "";

contextBridge.exposeInMainWorld("electronAPI", {
  openPreviewWindow: (url: string) => ipcRenderer.invoke("open-preview-window", url),
  appKey,
});

import { contextBridge, ipcRenderer } from "electron";

// main's per-launch key for this window (see main/lib/app-key.ts), and only
// for the app's own pages: the preload runs for whatever the window shows.
const APP_KEY_ARG = "--antidraw-app-key=";
const APP_PAGES = ["antidraw://app/", "http://localhost:5173/"];
const appKey = APP_PAGES.some((page) => location.href.startsWith(page))
  ? (process.argv.find((arg) => arg.startsWith(APP_KEY_ARG))?.slice(APP_KEY_ARG.length) ?? "")
  : "";

contextBridge.exposeInMainWorld("electronAPI", {
  openPreviewWindow: (url: string) => ipcRenderer.invoke("open-preview-window", url),
  appKey,
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateDownloaded: (callback: (version: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, version: string) =>
      callback(version);
    ipcRenderer.on("update:downloaded", listener);
    return () => ipcRenderer.removeListener("update:downloaded", listener);
  },
});

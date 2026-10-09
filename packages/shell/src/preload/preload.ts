import { contextBridge, ipcRenderer } from "electron";

// main's per-launch key for this window (see main/lib/app-key.ts), and only
// for the app's own pages: the preload runs for whatever the window shows.
const APP_KEY_ARG = "--antidraw-app-key=";
const APP_PAGES = ["antidraw://app/", "http://localhost:5173/"];
const appKey = APP_PAGES.some((page) => location.href.startsWith(page))
  ? (process.argv.find((arg) => arg.startsWith(APP_KEY_ARG))?.slice(APP_KEY_ARG.length) ?? "")
  : "";

contextBridge.exposeInMainWorld("electronAPI", {
  openPreviewWindow: (url: string, workspaceId?: string) =>
    ipcRenderer.invoke("open-preview-window", url, workspaceId),
  // A preview window's tags go to the main window's composer, by way of main.
  tagElement: (pick: unknown, url: string) => ipcRenderer.invoke("inspector:tag", pick, url),
  onElementTagged: (callback: (pick: unknown, url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pick: unknown, url: string) =>
      callback(pick, url);
    ipcRenderer.on("inspector:tagged", listener);
    return () => ipcRenderer.removeListener("inspector:tagged", listener);
  },
  // A preview window's comment, for the main window: show it there, and with
  // `send`, send the drafts there.
  showComments: (request: { commentId: number; send: boolean }) =>
    ipcRenderer.invoke("comments:show", request),
  onCommentsShown: (callback: (request: { commentId: number; send: boolean }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: { commentId: number; send: boolean },
    ) => callback(request);
    ipcRenderer.on("comments:shown", listener);
    return () => ipcRenderer.removeListener("comments:shown", listener);
  },
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

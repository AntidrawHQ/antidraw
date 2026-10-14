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
  // A preview window's comment, for the main window: show it there, and with
  // `send`, send the drafts there; with `chat`, open that chat (its set's).
  showComments: (request: { workspaceId: string; commentId: number; send: boolean; chat?: string }) =>
    ipcRenderer.invoke("comments:show", request),
  onCommentsShown: (callback: (request: { workspaceId: string; commentId: number; send: boolean; chat?: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: { workspaceId: string; commentId: number; send: boolean; chat?: string },
    ) => callback(request);
    ipcRenderer.on("comments:shown", listener);
    // One made while this window was closed, which opened it.
    void ipcRenderer.invoke("comments:pending").then((pending) => pending && callback(pending));
    return () => ipcRenderer.removeListener("comments:shown", listener);
  },
  // The main window's canvas as a workspace's thumbnail (main.ts).
  captureThumbnail: (workspaceId: string, rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("thumbnail:capture", workspaceId, rect),
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

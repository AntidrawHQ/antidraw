import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type SpawnTerminalOptions = {
  workspaceId: string;
  cols: number;
  rows: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
};

type TerminalSessionInfo = {
  sessionId: string;
  pid: number;
  shell: string;
  workspaceId: string;
  title: string;
};

type ExitPayload = { exitCode: number; signal?: number };

const subscribe = <T>(channel: string, handler: (payload: T) => void) => {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("electronAPI", {
  openPreviewWindow: (url: string) => ipcRenderer.invoke("open-preview-window", url),
  terminal: {
    create: (opts: SpawnTerminalOptions): Promise<TerminalSessionInfo> =>
      ipcRenderer.invoke("terminal:create", opts),
    input: (sessionId: string, data: string): void => {
      ipcRenderer.send("terminal:input", sessionId, data);
    },
    resize: (sessionId: string, cols: number, rows: number): void => {
      ipcRenderer.send("terminal:resize", sessionId, cols, rows);
    },
    dispose: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke("terminal:dispose", sessionId),
    list: (workspaceId?: string): Promise<TerminalSessionInfo[]> =>
      ipcRenderer.invoke("terminal:list", workspaceId),
    onOutput: (sessionId: string, handler: (data: string) => void) =>
      subscribe<string>(`terminal:output:${sessionId}`, handler),
    onExit: (sessionId: string, handler: (payload: ExitPayload) => void) =>
      subscribe<ExitPayload>(`terminal:exit:${sessionId}`, handler),
    onTitle: (sessionId: string, handler: (title: string) => void) =>
      subscribe<string>(`terminal:title:${sessionId}`, handler),
  },
});

import { ipcMain, BrowserWindow } from "electron";
import {
  createTerminalSession,
  writeToTerminal,
  resizeTerminal,
  disposeTerminal,
  listTerminalSessions,
  terminalEvents,
  type SpawnTerminalOptions,
  type TerminalSessionInfo,
} from "@/main/api/services/terminal.service";

// IPC channels. Output is per-session (`terminal:output:<sessionId>`) so each
// renderer-side terminal can attach a tight listener and the main process can
// route data to a single channel — no fan-out, no string filtering per message.
export const TERMINAL_CHANNELS = {
  create: "terminal:create",
  input: "terminal:input",
  resize: "terminal:resize",
  dispose: "terminal:dispose",
  list: "terminal:list",
  exit: (sessionId: string) => `terminal:exit:${sessionId}`,
  output: (sessionId: string) => `terminal:output:${sessionId}`,
  title: (sessionId: string) => `terminal:title:${sessionId}`,
} as const;

const broadcast = (channel: string, ...args: unknown[]) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
};

let wired = false;

export const registerTerminalIpc = () => {
  if (wired) return;
  wired = true;

  terminalEvents.on("output", (sessionId, data) => {
    broadcast(TERMINAL_CHANNELS.output(sessionId), data);
  });
  terminalEvents.on("exit", (sessionId, payload) => {
    broadcast(TERMINAL_CHANNELS.exit(sessionId), payload);
  });
  terminalEvents.on("title", (sessionId, title) => {
    broadcast(TERMINAL_CHANNELS.title(sessionId), title);
  });

  ipcMain.handle(
    TERMINAL_CHANNELS.create,
    (_event, opts: SpawnTerminalOptions): TerminalSessionInfo => {
      return createTerminalSession(opts);
    },
  );

  ipcMain.on(TERMINAL_CHANNELS.input, (_event, sessionId: string, data: string) => {
    writeToTerminal(sessionId, data);
  });

  ipcMain.on(
    TERMINAL_CHANNELS.resize,
    (_event, sessionId: string, cols: number, rows: number) => {
      resizeTerminal(sessionId, cols, rows);
    },
  );

  ipcMain.handle(TERMINAL_CHANNELS.dispose, (_event, sessionId: string) => {
    return disposeTerminal(sessionId);
  });

  ipcMain.handle(TERMINAL_CHANNELS.list, (_event, workspaceId?: string) => {
    return listTerminalSessions(workspaceId);
  });
};

export type { TerminalSessionInfo, SpawnTerminalOptions };

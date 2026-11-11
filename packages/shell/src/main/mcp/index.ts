import { ipcMain, type BrowserWindow, type WebContents } from "electron";
import { installBridgeCommand, writeToolCache } from "./bridge-install";
import { dropMirrorWith, setMirror } from "./canvas-mirror";
import { loadMcpConfig, mcpPort } from "./config";
import { localCanvasState, localWorkspaceHost } from "./local";
import { startMcpHttpServer, type RunningMcpServer } from "./server";

// The MCP server for outside agents (./server.ts), started once the app is
// ready and stopped as it quits; and the main window's mirrored canvas it
// reads (./canvas-mirror.ts). A server that can't start (its port taken)
// is logged and left: the app runs without it. Agents reach it through
// `antidraw mcp` (./bridge), put in place here too (./bridge-install.ts).

let running: RunningMcpServer | null = null;
let stopped = false;

export const startMcp = async (getMainWindow: () => BrowserWindow | null) => {
  // Only the main window's renderer mirrors: a preview window's picks are
  // its own. Its mirror goes with it.
  const watched = new WeakSet<WebContents>();
  ipcMain.on("canvas:mirror", (event, value: unknown) => {
    if (event.sender !== getMainWindow()?.webContents || !setMirror(value)) return;
    if (watched.has(event.sender)) return;
    watched.add(event.sender);
    dropMirrorWith(event.sender);
  });

  const deps = { host: localWorkspaceHost, canvas: localCanvasState(getMainWindow) };
  try {
    installBridgeCommand();
    await writeToolCache(deps);
  } catch (e) {
    console.error("[mcp] `antidraw mcp` not put in place:", e);
  }

  try {
    const port = mcpPort();
    const { token } = loadMcpConfig(port);
    const result = await startMcpHttpServer({ port, token, deps });
    if (result.isErr()) return console.error(`[mcp] not started: ${result.error}`);
    if (stopped) return void result.value.close();
    running = result.value;
    console.log(`[mcp] listening at http://127.0.0.1:${running.port}/mcp`);
  } catch (e) {
    console.error("[mcp] not started:", e);
  }
};

export const stopMcp = () => {
  stopped = true;
  void running?.close();
  running = null;
};

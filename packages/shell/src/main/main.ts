import { app, BrowserWindow, ipcMain, protocol, session } from "electron";
import path from "path";

import { app as HonoAPI } from "./api";

// Increase file descriptor limit for POSIX systems (macOS/Linux)
// Each network connection uses a file descriptor - with many iframes
// making concurrent requests, the default limit (often 256-1024) can be exhausted
if (process.platform !== "win32") {
  try {
    process.setFdLimit(8192);
  } catch {
    // Fall back to system default if hard limit is lower than 8192
  }
}

import {
  cleanupOrphanedProcesses,
  stopAllDevServers,
} from "./services/dev-server.service";
import { installNodeShim } from "./lib/node-shim";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "antidraw",
    privileges: {
      standard: true,
      stream: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(() => {
  installNodeShim();

  // Trust self-signed certs for localhost (enables HTTPS dev servers without warnings)
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === "localhost" || request.hostname === "127.0.0.1") {
      callback(0); // Trust
    } else {
      callback(-2); // Use default verification
    }
  });

  protocol.handle("antidraw", (req) => HonoAPI.fetch(req));

  createWindow();

  ipcMain.handle("open-preview-window", (_event, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid URL");
    }

    if (parsed.protocol !== "https:" || parsed.hostname !== "localhost" || parsed.pathname !== "/preview") {
      throw new Error("URL must be an https://localhost/preview URL");
    }

    const previewWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      center: true,
      backgroundColor: "#0a0a0a",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    previewWindow.loadURL(url);
  });

  // Cleanup any orphaned dev servers from previous crash (non-blocking)
  cleanupOrphanedProcesses().catch((err) => {
    console.error("Failed to cleanup orphaned processes:", err);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Graceful shutdown - stop all dev servers before quitting
app.on("before-quit", () => {
  stopAllDevServers();
});

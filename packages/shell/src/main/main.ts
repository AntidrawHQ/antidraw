import { app, BrowserWindow, protocol } from "electron";
import path from "path";

import { app as HonoAPI } from "./api";
import {
  cleanupOrphanedProcesses,
  stopAllDevServers,
} from "./services/dev-server.service";

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
    backgroundColor: "#0a0a0a", // Matches dark mode background - prevents white flash on resize
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
  protocol.handle("antidraw", (req) => HonoAPI.fetch(req));

  createWindow();

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

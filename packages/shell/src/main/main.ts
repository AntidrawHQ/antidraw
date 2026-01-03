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
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(() => {
  // Cleanup any orphaned dev servers from previous crash
  cleanupOrphanedProcesses();

  protocol.handle("antidraw", (req) => HonoAPI.fetch(req));

  createWindow();

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

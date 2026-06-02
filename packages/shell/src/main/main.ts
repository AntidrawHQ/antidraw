import { app, BrowserWindow, ipcMain, net, protocol, session } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

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
import { runMigrations } from "./db/migrate";
import { resetStreamingConversations } from "./api/services/chat.service";

// Keep the renderer responsive when the window is unfocused or occluded.
// Without these, Chromium throttles rAF/timers/request scheduling in packaged
// builds, which surfaces as SSE drops and canvas stutter.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
// IntensiveWakeUpThrottling clamps timers to 1/min after a page is hidden for
// 5 minutes regardless of the switches above. CalculateNativeWinOcclusion can
// flag the window as occluded under normal multi-window use on Windows and
// re-trigger throttling. Both must be disabled via --disable-features.
app.commandLine.appendSwitch(
  "disable-features",
  "IntensiveWakeUpThrottling,CalculateNativeWinOcclusion",
);

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
      backgroundThrottling: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadURL("antidraw://app/");
  }
};

// Serve renderer assets out of dist/renderer with an SPA fallback to index.html
// for any path that doesn't resolve to a file. Lets the TanStack Router own
// client-side routing the same way it does in dev.
const RENDERER_DIR = path.join(__dirname, "../renderer");
const INDEX_FILE_URL = pathToFileURL(
  path.join(RENDERER_DIR, "index.html"),
).toString();

const serveRendererAsset = async (pathname: string): Promise<Response> => {
  const safePath = path.normalize(pathname).replace(/^[/\\]+/, "");
  const candidate = path.join(RENDERER_DIR, safePath);

  if (
    candidate !== RENDERER_DIR &&
    !candidate.startsWith(RENDERER_DIR + path.sep)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const stat = await fs.promises.stat(candidate);
    if (stat.isFile()) {
      return net.fetch(pathToFileURL(candidate).toString());
    }
  } catch {
    // fall through to SPA fallback
  }

  return net.fetch(INDEX_FILE_URL);
};

app.whenReady().then(async () => {
  installNodeShim();

  // Apply pending schema migrations before anything queries the DB. If this
  // fails the app is unusable, so surface the error and exit instead of
  // limping along with a half-initialized DB.
  try {
    await runMigrations();
  } catch (err) {
    console.error("Database migration failed:", err);
    app.quit();
    return;
  }

  // Crash recovery: any conversation persisted as "streaming" is stale
  // (in-memory streams don't survive a process exit). Reset before the
  // renderer queries.
  await resetStreamingConversations();

  // Trust self-signed certs for localhost (enables HTTPS dev servers without warnings)
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === "localhost" || request.hostname === "127.0.0.1") {
      callback(0); // Trust
    } else {
      callback(-2); // Use default verification
    }
  });

  protocol.handle("antidraw", (req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return HonoAPI.fetch(req);
    }
    return serveRendererAsset(url.pathname);
  });

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
        backgroundThrottling: false,
      },
    });

    previewWindow.loadURL(url);
  });

  // Cleanup any orphaned dev servers from previous crash (non-blocking)
  cleanupOrphanedProcesses().catch((err) => {
    console.error("Failed to cleanup orphaned processes:", err);
  });

  // Auto-update — checks GitHub Releases for a newer signed build,
  // downloads in the background, prompts the user to restart on next quit.
  // No-op in development (electron-updater detects unpackaged apps).
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("Auto-update check failed:", err);
    });
  }

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

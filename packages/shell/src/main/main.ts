import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from "electron";
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
import { shutdownPostHog } from "./lib/posthog";
import { APP_KEY, APP_KEY_ARG } from "@/main/lib/app-key";
import { verifyCertificate } from "@/main/lib/certificate-verify";

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

// Version of a fully downloaded, ready-to-install update. Renderers that
// mount after "update-downloaded" fired pull this via update:get-status.
let pendingUpdateVersion: string | null = null;

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

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

// The app's own pages. A window stays on them: the main window's preload
// hands out the account key (lib/app-key.ts), and a page that replaced the app
// would get it. Web links (an assistant reply's markdown, say) open in the
// browser instead.
const APP_PAGE = process.env.NODE_ENV === "development" ? "http://localhost:5173/" : "antidraw://app/";

const stayOnApp = (win: BrowserWindow) => {
  const openInBrowser = (url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
  };
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_PAGE)) return;
    event.preventDefault();
    openInBrowser(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
};

// Where elements tagged in a preview window go (see "inspector:tag").
let mainWindow: BrowserWindow | null = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const previewWindows = new Set<Electron.WebContents>();

const createWindow = () => {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    // The titlebar's workspace switcher and Publish button need the room.
    minWidth: 480,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      additionalArguments: [`${APP_KEY_ARG}${APP_KEY}`],
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadURL(APP_PAGE);
  stayOnApp(win);
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

  // Trust self-signed certs for localhost (enables HTTPS dev servers without
  // warnings); every other host gets Chromium's own verification.
  session.defaultSession.setCertificateVerifyProc(verifyCertificate);

  protocol.handle("antidraw", (req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return HonoAPI.fetch(req);
    }
    return serveRendererAsset(url.pathname);
  });

  createWindow();

  ipcMain.handle("open-preview-window", (_event, url: string, workspaceId?: unknown) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid URL");
    }

    if (parsed.protocol !== "https:" || parsed.hostname !== "localhost" || parsed.pathname !== "/preview") {
      throw new Error("URL must be an https://localhost/preview URL");
    }

    // Chrome like the main window's: the page draws the titlebar
    // (renderer/PreviewWindow.tsx) and shows the component in a frame under
    // it. No account key: the page has no use for it.
    const previewWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 400,
      center: true,
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
    const contents = previewWindow.webContents;
    previewWindows.add(contents);
    previewWindow.on("closed", () => previewWindows.delete(contents));

    // The workspace, for the comments it leaves (renderer/comments).
    const page = new URL(`${APP_PAGE}preview-window.html`);
    page.searchParams.set("url", url);
    if (typeof workspaceId === "string" && UUID_RE.test(workspaceId))
      page.searchParams.set("workspace", workspaceId);
    previewWindow.loadURL(page.toString());
    stayOnApp(previewWindow);
  });

  // An element tagged in a preview window, for the main window's composer.
  ipcMain.handle("inspector:tag", (event, pick: unknown, url: unknown) => {
    if (!previewWindows.has(event.sender) || typeof url !== "string") return;
    mainWindow?.webContents.send("inspector:tagged", pick, url);
  });

  // A preview window's comment, for the main window's list: bring it
  // forward, show the comment, and with `send`, send the drafts there.
  ipcMain.handle("comments:show", (event, request: unknown) => {
    if (!previewWindows.has(event.sender) || !mainWindow) return;
    const { commentId, send } = (request ?? {}) as { commentId?: unknown; send?: unknown };
    if (typeof commentId !== "number") return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("comments:shown", { commentId, send: send === true });
  });

  // Cleanup any orphaned dev servers from previous crash (non-blocking)
  cleanupOrphanedProcesses().catch((err) => {
    console.error("Failed to cleanup orphaned processes:", err);
  });

  ipcMain.handle("update:get-status", () => ({
    pendingVersion: pendingUpdateVersion,
  }));

  ipcMain.handle("update:install", () => {
    autoUpdater.quitAndInstall();
  });

  // Auto-update — checks GitHub Releases for a newer signed build and
  // downloads it in the background. Once ready, the renderer shows a
  // "Restart to update" button; the update also installs on normal quit
  // (autoInstallOnAppQuit). No-op in development (electron-updater
  // detects unpackaged apps).
  if (app.isPackaged) {
    autoUpdater.on("update-downloaded", (event) => {
      pendingUpdateVersion = event.version;
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("update:downloaded", event.version);
      }
    });

    // Downloads are started here rather than by electron-updater, so a check
    // that finds the version already downloaded does nothing. Left to
    // autoDownload, every check would re-validate the cached update and, on
    // macOS, have Squirrel stage it again.
    autoUpdater.autoDownload = false;

    const checkForUpdates = () => {
      autoUpdater
        .checkForUpdates()
        .then((result) => {
          if (!result?.isUpdateAvailable) return;
          if (result.updateInfo.version === pendingUpdateVersion) return;
          return autoUpdater.downloadUpdate();
        })
        .catch((err) => {
          console.error("Auto-update failed:", err);
        });
    };
    checkForUpdates();
    setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
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

// Graceful shutdown - stop all dev servers and flush analytics before quitting
app.on("before-quit", () => {
  stopAllDevServers();
  void shutdownPostHog();
});

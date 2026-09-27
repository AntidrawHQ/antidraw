import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { err, ok, type Result } from "neverthrow";
import { getFrameLayouts } from "@/main/api/services/frame-layout.service";
import { getNodeElectronPath, getShimmedSpawnEnv } from "@/main/lib/node-shim";
import { getPublishResources } from "@/main/services/publish/resources";
import {
  assembleSite,
  emptyOutDir,
  listSiteFiles,
  makeCanvasFile,
  readCanvasComponents,
  type SiteFile,
} from "@/publish/site-build";

export type SiteBuildError = {
  code:
    | "RESOURCES_MISSING"
    | "DEPENDENCIES_MISSING"
    | "BUILD_FAILED"
    | "BUILD_TIMEOUT"
    | "SITE_ASSEMBLY_FAILED"
    | "CANCELLED";
  message: string;
  // The last LOG_TAIL_LINES lines of the build's output.
  logTail?: string[];
};

export type BuiltSite = {
  dir: string;
  files: SiteFile[];
  entries: SiteFile[];
  skipped: string[];
  componentCount: number;
  totalBytes: number;
};

export type BuildWorkspaceSiteOptions = {
  // Whose frame layouts go into canvas.json.
  workspaceId: string;
  // canvas.json's name.
  workspaceName: string;
  // What is built: the staged snapshot, not the live workspace.
  stagedSourceDir: string;
  // <workspace>/source/node_modules, linked into the staged tree for the build.
  nodeModulesDir: string;
  // Must not exist yet.
  outDir: string;
  // Vite's cache, kept out of the workspace's node_modules.
  cacheDir: string;
  signal?: AbortSignal;
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5000;
const LOG_TAIL_LINES = 40;
const ANSI_COLOR_RE = /\x1b\[[0-9;]*m/g;

// The only variables the build child gets. getShimmedSpawnEnv spreads all of
// process.env, and a build publishes what it reads from it: Vite copies every
// VITE_* variable into import.meta.env, and a workspace config can `define`
// any other. An app started from a terminal would otherwise publish the
// user's shell environment.
const BUILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_ENV",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_PATH",
];
const WIN32_BUILD_ENV_KEYS = [
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
];

export const buildEnv = (): NodeJS.ProcessEnv => {
  const shimmed = getShimmedSpawnEnv({ NODE_ENV: "production" });
  const keys =
    process.platform === "win32" ? [...BUILD_ENV_KEYS, ...WIN32_BUILD_ENV_KEYS] : BUILD_ENV_KEYS;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    if (shimmed[key] !== undefined) env[key] = shimmed[key];
  }
  return env;
};

type ChildOutcome = "ok" | "failed" | "timeout" | "cancelled" | { spawnError: string };

// After the child exits, how long its pipes may stay open (held by a
// grandchild it left behind) before the outcome is taken from the exit code.
const EXIT_PIPE_GRACE_MS = 2000;

// Runs the build child to its end. The child leads its own process group
// (not on win32), so cancelling or timing out signals everything it started:
// SIGTERM, then SIGKILL if it is still running KILL_GRACE_MS later. A stopped
// build settles as soon as the child exits, or KILL_GRACE_MS after SIGKILL
// whatever happens; a build that ends on its own settles on 'close' (every
// log line read), or EXIT_PIPE_GRACE_MS after exit if a grandchild keeps the
// pipes open. On settling, whatever is left of the group is killed, so
// nothing writes to the out dir afterwards.
const runBuildChild = (
  args: string[],
  opts: {
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
    onLine: (line: string, stream: "stdout" | "stderr") => void;
  },
) =>
  new Promise<ChildOutcome>((resolve) => {
    const useGroup = process.platform !== "win32";
    const child = spawn(getNodeElectronPath(), args, {
      cwd: opts.cwd,
      env: buildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: useGroup,
    });

    const signalAll = (sig: NodeJS.Signals) => {
      if (useGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, sig);
          return;
        } catch {
          // ESRCH: the group is gone; fall through for the child itself.
        }
      }
      try {
        child.kill(sig);
      } catch {
        // Already gone.
      }
    };
    const closePipes = () => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    };

    let settled = false;
    let stopped: "timeout" | "cancelled" | null = null;
    let exitCode: number | null | undefined;
    const timers: NodeJS.Timeout[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    const settle = (outcome: ChildOutcome) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      opts.signal?.removeEventListener("abort", onAbort);
      if (child.pid !== undefined) {
        // Anything the build left running.
        if (useGroup) signalAll("SIGKILL");
        closePipes();
      }
      resolve(outcome);
    };
    const finished = () => stopped ?? (exitCode === 0 ? "ok" : "failed");

    const stop = (reason: "timeout" | "cancelled") => {
      if (stopped || settled) return;
      stopped = reason;
      if (exitCode !== undefined) {
        settle(reason);
        return;
      }
      signalAll("SIGTERM");
      later(KILL_GRACE_MS, () => {
        signalAll("SIGKILL");
        later(KILL_GRACE_MS, () => settle(reason));
      });
    };
    const onAbort = () => stop("cancelled");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    later(opts.timeoutMs, () => stop("timeout"));

    for (const stream of ["stdout", "stderr"] as const) {
      readline
        .createInterface({ input: child[stream], crlfDelay: Infinity })
        .on("line", (line) => opts.onLine(line.replace(ANSI_COLOR_RE, ""), stream));
    }

    child.on("error", (e) => {
      // Spawning failed; there is no process to wait for.
      if (child.pid === undefined) settle({ spawnError: e.message });
    });
    child.on("exit", (code) => {
      exitCode = code;
      if (stopped) settle(stopped);
      else later(EXIT_PIPE_GRACE_MS, () => settle(finished()));
    });
    child.on("close", (code) => {
      if (exitCode === undefined) exitCode = code;
      settle(finished());
    });
  });

// Builds the staged workspace into a site in outDir: the workspace build in a
// child (build-workspace.ts, run as Node by the Electron binary, with the
// workspace's own Vite), then the viewer and canvas.json added to it
// (assembleSite), then its files listed for upload.
export const buildWorkspaceSite = async (
  opts: BuildWorkspaceSiteOptions,
): Promise<Result<BuiltSite, SiteBuildError>> => {
  const resources = getPublishResources();
  if (resources.isErr()) return err(resources.error);
  const { viewerDir, runtimeSrc, buildScript } = resources.value;

  if (!fs.statSync(opts.nodeModulesDir, { throwIfNoEntry: false })?.isDirectory()) {
    return err({
      code: "DEPENDENCIES_MISSING",
      message: "The workspace's dependencies are not installed. Install them, then publish again.",
    });
  }
  if (fs.existsSync(opts.outDir)) {
    return err({ code: "BUILD_FAILED", message: `${opts.outDir} already exists` });
  }
  if (opts.signal?.aborted) return err({ code: "CANCELLED", message: "Publish was cancelled" });

  // The staged tree has no node_modules of its own (snapshots never do): the
  // build uses the workspace's installed ones.
  const link = path.join(opts.stagedSourceDir, "node_modules");
  try {
    fs.symlinkSync(opts.nodeModulesDir, link, process.platform === "win32" ? "junction" : "dir");
  } catch (e) {
    return err({
      code: "BUILD_FAILED",
      message: `Could not link the workspace's dependencies: ${(e as Error).message}`,
    });
  }

  try {
    const tail: string[] = [];
    const outcome = await runBuildChild([buildScript, opts.outDir, runtimeSrc, opts.cacheDir], {
      cwd: opts.stagedSourceDir,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onLine: (line, stream) => {
        tail.push(line);
        if (tail.length > LOG_TAIL_LINES) tail.shift();
        opts.onLog?.(line, stream);
      },
    });
    if (outcome !== "ok") {
      // Vite may have written part of a build.
      emptyOutDir(opts.outDir);
      const logTail = [...tail];
      if (outcome === "cancelled") return err({ code: "CANCELLED", message: "Publish was cancelled" });
      if (outcome === "timeout") {
        const minutes = Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60000);
        return err({
          code: "BUILD_TIMEOUT",
          message: `The build did not finish within ${minutes} minutes`,
          logTail,
        });
      }
      if (outcome === "failed") {
        return err({ code: "BUILD_FAILED", message: "The workspace build failed", logTail });
      }
      return err({
        code: "BUILD_FAILED",
        message: `Could not start the build: ${outcome.spawnError}`,
        logTail,
      });
    }

    const layouts = await getFrameLayouts(opts.workspaceId);
    if (layouts.isErr()) {
      emptyOutDir(opts.outDir);
      return err({ code: "SITE_ASSEMBLY_FAILED", message: layouts.error.message });
    }
    const canvas = makeCanvasFile(
      opts.workspaceName,
      readCanvasComponents(opts.stagedSourceDir),
      layouts.value.map(({ workspaceId: _workspaceId, ...layout }) => layout),
    );
    const assembled = assembleSite({ outDir: opts.outDir, viewerDir, canvas });
    if (assembled.isErr()) return err(assembled.error);

    try {
      const { files, entries, skipped } = await listSiteFiles(opts.outDir);
      return ok({
        dir: opts.outDir,
        files,
        entries,
        skipped,
        componentCount: canvas.components.length,
        totalBytes: [...files, ...entries].reduce((sum, f) => sum + f.size, 0),
      });
    } catch (e) {
      emptyOutDir(opts.outDir);
      return err({ code: "SITE_ASSEMBLY_FAILED", message: (e as Error).message });
    }
  } finally {
    // The link only, never what it points at.
    try {
      fs.unlinkSync(link);
    } catch {
      // Already gone.
    }
  }
};

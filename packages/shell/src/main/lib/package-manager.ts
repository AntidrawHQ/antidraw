import { exec, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getNodeElectronPath, getShimmedSpawnEnv } from "@/main/lib/node-shim";

export type NpmOutput =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null };

// Resolve npm CLI path by finding package.json first (allowed by exports), then constructing path
const require_ = createRequire(import.meta.url);
const npmDir = dirname(require_.resolve("npm/package.json"));
const npmCli = join(npmDir, "bin", "npm-cli.js");

export const spawnNpm = (
  args: string[],
  cwd: string,
  options: Omit<SpawnOptions, "cwd" | "env"> & { env?: NodeJS.ProcessEnv } = {},
): ChildProcess =>
  spawn(getNodeElectronPath(), [npmCli, ...args], {
    ...options,
    cwd,
    env: getShimmedSpawnEnv(options.env),
  });

// How long npm gets between a stop and the next, harder one.
const AGAIN_MS = 200;
const KILL_MS = 3_000;

// Stops npm and whatever it's running (a package's install script), all of
// it. npm takes the first SIGTERM as "stop once this step is done", which
// can be every download or every install script, and the second as "stop
// now"; anything left once npm has gone, or after KILL_MS, is killed. On
// Windows, taskkill ends the whole tree at once.
const stopNpm = (child: ChildProcess) => {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    exec(`taskkill /pid ${pid} /T /F`, () => {});
    return;
  }
  // npm leads its own process group (detached), so this reaches its scripts.
  const group = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // Gone already.
    }
  };
  group("SIGTERM");
  const again = setTimeout(() => group("SIGTERM"), AGAIN_MS);
  const kill = setTimeout(() => group("SIGKILL"), KILL_MS);
  // npm gone, what it ran mustn't outlive it: a script that doesn't stop for
  // a SIGTERM would go on writing into the folder about to be removed.
  child.once("close", () => {
    clearTimeout(again);
    clearTimeout(kill);
    group("SIGKILL");
  });
};

// An abort stops npm and what it runs (stopNpm); its output then ends with
// an exit whose code isn't 0.
export async function* runNpm(args: string[], cwd: string, signal?: AbortSignal): AsyncGenerator<NpmOutput> {
  try {

    const stream = new ReadableStream<NpmOutput>({
      start(controller) {
        // Its own process group when it can be stopped, so stopping it
        // reaches what it runs.
        const child = spawnNpm(args, cwd, signal ? { detached: process.platform !== "win32" } : {});
        const stop = () => stopNpm(child);
        if (signal?.aborted) stop();
        else signal?.addEventListener("abort", stop, { once: true });
        child.on("close", () => signal?.removeEventListener("abort", stop));

        child.stdout?.on("data", (data: Buffer) => {
          controller.enqueue({ type: "stdout", data: data.toString() });
        });

        child.stderr?.on("data", (data: Buffer) => {
          controller.enqueue({ type: "stderr", data: data.toString() });
        });

        child.on("close", (code) => {
          controller.enqueue({ type: "exit", code });
          controller.close();
        });

        child.on("error", (error) => {
          controller.enqueue({ type: "stderr", data: error.message });
          controller.enqueue({ type: "exit", code: 1 });
          controller.close();
        });
      },
    });

    yield* stream;
  } catch (e) {
    yield { type: "stderr", data: e instanceof Error ? e.message : String(e) };
    yield { type: "exit", code: 1 };
  }
}

// --loglevel info makes npm stream per-request fetch lines and lifecycle
// events (extract, postinstall scripts); without it, npm install is silent
// until the final summary and the UI looks frozen
export const npmInstall = (cwd: string, signal?: AbortSignal) =>
  runNpm(["install", "--loglevel", "info"], cwd, signal);

export const npmCreate = (template: string, name: string, cwd: string) =>
  runNpm(["create", `${template}@latest`, name, "--yes", "--loglevel", "info"], cwd);

export const npmUpdate = (cwd: string, pkg?: string) =>
  runNpm(pkg ? ["update", pkg] : ["update"], cwd);

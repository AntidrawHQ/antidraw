import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getShimmedSpawnEnv } from "@/main/lib/node-shim";

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
  options: Omit<SpawnOptions, "cwd" | "env"> = {},
): ChildProcess =>
  spawn(process.execPath, [npmCli, ...args], {
    ...options,
    cwd,
    env: getShimmedSpawnEnv(),
  });

export async function* runNpm(args: string[], cwd: string): AsyncGenerator<NpmOutput> {
  try {

    const stream = new ReadableStream<NpmOutput>({
      start(controller) {
        const child = spawnNpm(args, cwd);

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

export const npmInstall = (cwd: string) => runNpm(["install"], cwd);

export const npmCreate = (template: string, name: string, cwd: string) =>
  runNpm(["create", `${template}@latest`, name, "--yes"], cwd);

export const npmUpdate = (cwd: string, pkg?: string) =>
  runNpm(pkg ? ["update", pkg] : ["update"], cwd);

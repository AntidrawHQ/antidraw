import { spawn } from "node:child_process";

export type NpmOutput =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null };

export async function* runNpm(args: string[], cwd: string): AsyncGenerator<NpmOutput> {
  const npmCli = require.resolve("npm/bin/npm-cli.js");

  const stream = new ReadableStream<NpmOutput>({
    start(controller) {
      const child = spawn(process.execPath, [npmCli, ...args], {
        cwd,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
        },
      });

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
}

export const npmInstall = (cwd: string) => runNpm(["install"], cwd);

export const npmCreate = (template: string, name: string, cwd: string) =>
  runNpm(["create", `${template}@latest`, name, "--yes"], cwd);

export const npmUpdate = (cwd: string, pkg?: string) =>
  runNpm(pkg ? ["update", pkg] : ["update"], cwd);

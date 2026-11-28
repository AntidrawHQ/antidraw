import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { npmInstall, type NpmOutput } from "../package-manager";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

// npm takes the first SIGTERM as "stop once this step is done", so a single
// kill left a package's install script running, and npm waiting on it, for
// as long as it took. This one's script doesn't stop for a SIGTERM at all,
// as a shell waiting on a command doesn't.
it("stops npm install, and the install script it's running, when aborted", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-npm-")));
  dirs.push(root);
  const ticks = path.join(root, "ticks");
  // A package whose install script never ends, noting it's still going. A
  // tarball, as from a registry: a folder would be linked, its script not run.
  await fs.mkdir(path.join(root, "package"));
  await fs.writeFile(
    path.join(root, "package", "package.json"),
    JSON.stringify({
      name: "dep",
      version: "1.0.0",
      scripts: { postinstall: "node tick.js" },
    }),
  );
  await fs.writeFile(
    path.join(root, "package", "tick.js"),
    `process.on("SIGTERM", () => {});\nsetInterval(() => require("fs").appendFileSync(${JSON.stringify(ticks)}, "."), 50);\n`,
  );
  execFileSync("tar", ["-czf", "dep.tgz", "package"], { cwd: root });
  await fs.mkdir(path.join(root, "app"));
  await fs.writeFile(
    path.join(root, "app", "package.json"),
    JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:../dep.tgz" } }),
  );

  const abort = new AbortController();
  const size = () => fs.stat(ticks).then(({ size }) => size, () => 0);
  // Stopped once the script is going.
  let done = false;
  const running = (async () => {
    while (!done && (await size()) === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    abort.abort();
    return Date.now();
  })();
  const outputs: NpmOutput[] = [];
  for await (const output of npmInstall(path.join(root, "app"), abort.signal)) outputs.push(output);
  done = true;
  const took = Date.now() - (await running);

  const stopped = await size();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const last = outputs.at(-1);
  expect({
    ran: stopped > 0,
    // Killed, or rolled back as it stopped: not installed, either way.
    failed: last?.type === "exit" && last.code !== 0,
    // KILL_MS, and a little.
    quickly: took < 5_000,
    scriptStopped: (await size()) === stopped,
  }).toEqual({ ran: true, failed: true, quickly: true, scriptStopped: true });
}, 20_000);

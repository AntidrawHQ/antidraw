// Stands in for dist/publish-child/build-workspace.mjs in site-builder tests:
//
//   fake-build-child.mjs <out dir> <runtime src dir> <cache dir>
//
// Run in the staged source dir, it writes a minimal workspace build into
// <out dir>, as the real one does. The build's environment is allowlisted, so
// the test steers it with fake-build.json in the working directory:
//   { "mode": "ok" | "fail" | "hang", "lines"?: number }
// It prints the names of the variables it got, and where node_modules leads.

import fs from "node:fs";
import path from "node:path";

const [outDir, runtimeSrc, cacheDir] = process.argv.slice(2);
const { mode = "ok", lines = 0 } = JSON.parse(fs.readFileSync("fake-build.json", "utf8"));

console.log(`ENV ${JSON.stringify(Object.keys(process.env).sort())}`);
console.log(`ARGS ${JSON.stringify({ outDir, runtimeSrc, cacheDir })}`);
console.log(`NODE_MODULES ${fs.realpathSync("node_modules")}`);
for (let i = 1; i <= lines; i++) console.log(`line ${i}`);

if (mode === "fail") {
  // Part of a build, as Vite leaves one that fails partway.
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "assets", "half.js"), "");
  console.error("error: the build broke");
  process.exit(1);
}

if (mode === "hang") {
  fs.writeFileSync("fake-build.pid", String(process.pid));
  console.log("hanging");
  setInterval(() => {}, 1000);
} else {
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(outDir, ".vite"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html><title>preview</title>");
  fs.writeFileSync(path.join(outDir, "assets", "index-AbCdEf12.js"), "console.log(1)");
  fs.writeFileSync(path.join(outDir, "robots.txt"), "User-agent: *");
  fs.writeFileSync(
    path.join(outDir, ".vite", "antidraw-emitted.json"),
    JSON.stringify(["assets/index-AbCdEf12.js", "index.html"]),
  );
  console.log("built");
}

// One publish build of a workspace, run as a child process in the workspace's
// source directory:
//
//   node build-workspace.ts <out dir> <runtime src dir>
//
// It builds with the workspace's own Vite and vite.config.ts (React,
// Tailwind, the runtime plugin's @ alias and dedupe) plus the app's publish
// plugins (vite-plugins.ts), with the preview page taken from <runtime src
// dir>: the app's copy of @antidrawapp/runtime/src. The workspace's cwd
// matters: the runtime plugin resolves its @ alias from it.

import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { publishPlugins } from "./vite-plugins.ts";

const [outDir, runtimeSrc] = process.argv.slice(2);
if (!outDir || !runtimeSrc) {
  console.error("usage: build-workspace.ts <out dir> <runtime src dir>");
  process.exit(1);
}

const root = process.cwd();
const viteDir = path.dirname(
  createRequire(path.join(root, "package.json")).resolve("vite/package.json"),
);
const vite: typeof import("vite") = await import(
  pathToFileURL(path.join(viteDir, "dist/node/index.js")).href
);

// The workspace's vite.config.ts is still loaded (configFile is left to Vite
// to find); its plugins come first and these are added after them. outDir is
// outside the workspace, so Vite would not empty it on its own; site.ts checks
// it is a site built before, or new. The manifest tells site.ts which files
// the build emitted (content-hashed) and which came from public/.
await vite.build({
  root,
  mode: "production",
  plugins: publishPlugins(vite, path.resolve(runtimeSrc)),
  build: { outDir: path.resolve(outDir), emptyOutDir: true, manifest: ".vite/manifest.json" },
});

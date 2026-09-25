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
import {
  failedWorkspaceFile,
  publishPlugins,
  redactPaths,
  type BrokenFiles,
} from "./vite-plugins.ts";

const [outDir, runtimeSrc] = process.argv.slice(2);
if (!outDir || !runtimeSrc) {
  console.error("usage: build-workspace.ts <out dir> <runtime src dir>");
  process.exit(1);
}

// Vite goes by NODE_ENV, not by mode, for whether a build is a production
// one, and takes it from the workspace's .env when it is not set yet: a
// development build would publish React's development build and the path of
// every source file (plugin-react's jsxDEV). Set before Vite is loaded.
process.env.NODE_ENV = "production";

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
// it is a site built before, or new. No source maps: they would publish this
// machine's paths (the app's runtime copy, the workspace's own location).
//
// A build that fails in one workspace file is built again with that file
// stubbed (see tolerateBrokenSource), up to a point.
const MAX_BROKEN_FILES = 25;
const broken: BrokenFiles = new Map();
for (;;) {
  try {
    await vite.build({
      root,
      mode: "production",
      // The site is served from the root of its own origin, whatever base
      // the workspace's config names.
      base: "/",
      plugins: publishPlugins(vite, path.resolve(runtimeSrc), broken),
      build: {
        outDir: path.resolve(outDir),
        emptyOutDir: true,
        sourcemap: false,
      },
    });
    break;
  } catch (error) {
    const file = failedWorkspaceFile(vite, root, error, broken);
    if (!file || broken.size >= MAX_BROKEN_FILES) throw error;
    const message = (error as Error).message.split("\n")[0]!;
    const relative = path.relative(root, file);
    broken.set(file, redactPaths(vite, root, `${relative} could not be built: ${message}`));
    console.warn(`\n[antidraw] building again without ${relative}\n`);
  }
}

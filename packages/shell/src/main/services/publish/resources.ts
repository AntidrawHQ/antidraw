import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import type { SiteBuildError } from "@/main/services/publish/site-builder";

// What a publish build needs besides the workspace:
//  - viewerDir: the built viewer (vite.viewer.config.ts), copied into every site
//  - runtimeSrc: the app's copy of @antidrawapp/runtime/src, for the preview page
//  - buildScript: build-workspace.ts compiled to one file (electron.vite.config.ts),
//    run as Node in the workspace
export type PublishResources = {
  viewerDir: string;
  runtimeSrc: string;
  buildScript: string;
};

const BUILD_SCRIPT = path.join("dist", "publish-child", "build-workspace.mjs");

// Packaged, the viewer and the runtime source are extraResources
// (electron-builder.yml), and the child script is unpacked from the asar: a
// Node child cannot run a file inside it. In dev, all three are in the repo.
export const getPublishResources = (): Result<PublishResources, SiteBuildError> => {
  const appPath = app.getAppPath();
  const resources: PublishResources = app.isPackaged
    ? {
        viewerDir: path.join(process.resourcesPath, "publish", "viewer"),
        runtimeSrc: path.join(process.resourcesPath, "publish", "runtime-src"),
        buildScript: path
          .join(appPath, BUILD_SCRIPT)
          .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`),
      }
    : {
        viewerDir: path.join(appPath, "dist-viewer"),
        runtimeSrc: path.resolve(appPath, "..", "plugin-runtime", "src"),
        buildScript: path.join(appPath, BUILD_SCRIPT),
      };

  const missing = [
    path.join(resources.viewerDir, "index.html"),
    path.join(resources.runtimeSrc, "load-component.ts"),
    resources.buildScript,
  ].filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    const hint = app.isPackaged
      ? "Reinstall Antidraw."
      : "Run npm run build:viewer and restart npm run dev.";
    return err({
      code: "RESOURCES_MISSING",
      message: `Publishing needs files the app does not have (${missing.join(", ")}). ${hint}`,
    });
  }
  return ok(resources);
};

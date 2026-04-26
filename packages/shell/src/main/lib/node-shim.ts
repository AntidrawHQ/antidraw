import fs from "node:fs";
import path from "node:path";
import { getAntidrawRoot } from "@/main/api/init";

const POSIX_SHIM = `#!/bin/sh
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_PATH" "$@"
`;

const WINDOWS_SHIM = `@echo off\r
set ELECTRON_RUN_AS_NODE=1\r
"%ELECTRON_PATH%" %*\r
`;

const isWindows = process.platform === "win32";

export const getShimDir = () => path.join(getAntidrawRoot(), "bin");

export const getShimNodePath = () =>
  path.join(getShimDir(), isWindows ? "node.cmd" : "node");

export const installNodeShim = () => {
  const shimDir = getShimDir();
  fs.mkdirSync(shimDir, { recursive: true });

  const shimPath = getShimNodePath();
  const desired = isWindows ? WINDOWS_SHIM : POSIX_SHIM;

  // Make the shim resolvable to any child process spawned from this main
  // process — including third-party libraries (e.g. the Claude Agent SDK)
  // that look up `node` via PATH and don't go through getShimmedSpawnEnv.
  const currentPath = process.env.PATH ?? "";
  if (!currentPath.startsWith(shimDir + path.delimiter)) {
    process.env.PATH = `${shimDir}${path.delimiter}${currentPath}`;
  }
  process.env.ELECTRON_PATH = process.execPath;

  let existing: string | null = null;
  try {
    existing = fs.readFileSync(shimPath, "utf8");
  } catch {
    // Missing — write below.
  }

  if (existing !== desired) {
    fs.writeFileSync(shimPath, desired);
  }

  if (!isWindows) {
    fs.chmodSync(shimPath, 0o755);
  }
};

export const getShimmedSpawnEnv = (
  extra?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const shimDir = getShimDir();
  const currentPath = process.env.PATH ?? "";
  const prefixed = currentPath.startsWith(shimDir + path.delimiter)
    ? currentPath
    : `${shimDir}${path.delimiter}${currentPath}`;

  return {
    ...process.env,
    ...extra,
    PATH: prefixed,
    ELECTRON_PATH: process.execPath,
    ELECTRON_RUN_AS_NODE: "1",
  };
};

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { getWorkspaceSourcePath } from "@/main/api/init";

const require_ = createRequire(import.meta.url);

// Resolves to the directory containing the runtime's package.json.
// In dev (running shell from the worktree): <repo>/packages/plugin-runtime,
// reached via the npm-workspaces symlink in the hoisted node_modules.
// In production (when electron-builder is wired up): the asar.unpacked path.
// Either way, Node's resolver gives us the right absolute path.
const getRuntimePath = (): string => {
  const pkgJsonPath = require_.resolve("@antidrawapp/runtime/package.json");
  return path.dirname(pkgJsonPath);
};

type LinkState = "symlink-correct" | "symlink-stale" | "real-dir" | "missing";

const inspectLink = async (
  linkPath: string,
  target: string,
): Promise<LinkState> => {
  try {
    const stat = await fs.lstat(linkPath);
    if (!stat.isSymbolicLink()) return "real-dir";
    const currentTarget = await fs.readlink(linkPath);
    const resolved = path.isAbsolute(currentTarget)
      ? currentTarget
      : path.resolve(path.dirname(linkPath), currentTarget);
    return resolved === target ? "symlink-correct" : "symlink-stale";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw e;
  }
};

export const ensureRuntimeSymlink = async (
  workspaceId: string,
): Promise<void> => {
  const target = getRuntimePath();
  // Lives outside node_modules so npm can't prune it. The template's
  // package.json declares the runtime as `file:./.antidraw/runtime`, which
  // makes npm install create node_modules/@antidrawapp/runtime as a
  // symlink to this location — preserving standard module resolution
  // everywhere while keeping the canonical pointer outside npm's reach.
  const linkPath = path.join(
    getWorkspaceSourcePath(workspaceId),
    ".antidraw",
    "runtime",
  );

  await fs.mkdir(path.dirname(linkPath), { recursive: true });

  const state = await inspectLink(linkPath, target);
  if (state === "symlink-correct") return;
  if (state !== "missing") {
    await fs.rm(linkPath, { recursive: true, force: true });
  }

  // Use junction on Windows so directory symlinks don't require elevated
  // privileges or Developer Mode. Behaves identically for our purposes.
  const symlinkType = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(target, linkPath, symlinkType);
};

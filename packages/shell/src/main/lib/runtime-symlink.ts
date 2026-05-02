import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { ok, err, type Result } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";

const require_ = createRequire(import.meta.url);

export const RuntimeSymlinkErrorCode = {
  RUNTIME_NOT_FOUND: "RUNTIME_NOT_FOUND",
  FS_ERROR: "FS_ERROR",
} as const;

type RuntimeSymlinkErrorCodeType =
  (typeof RuntimeSymlinkErrorCode)[keyof typeof RuntimeSymlinkErrorCode];

export type RuntimeSymlinkError = {
  code: RuntimeSymlinkErrorCodeType;
  message: string;
};

// Resolves to the directory containing the runtime's package.json.
// In dev (running shell from the worktree): <repo>/packages/plugin-runtime,
// reached via the npm-workspaces symlink in the hoisted node_modules.
// In production (when electron-builder is wired up): the asar.unpacked path.
// Either way, Node's resolver gives us the right absolute path.
const getRuntimePath = (): Result<string, RuntimeSymlinkError> => {
  try {
    const pkgJsonPath = require_.resolve("@antidrawapp/runtime/package.json");
    return ok(path.dirname(pkgJsonPath));
  } catch (e) {
    return err({
      code: RuntimeSymlinkErrorCode.RUNTIME_NOT_FOUND,
      message: e instanceof Error ? e.message : "Failed to resolve runtime",
    });
  }
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
): Promise<Result<void, RuntimeSymlinkError>> => {
  const targetResult = getRuntimePath();
  if (targetResult.isErr()) return err(targetResult.error);
  const target = targetResult.value;

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

  try {
    await fs.mkdir(path.dirname(linkPath), { recursive: true });

    const state = await inspectLink(linkPath, target);
    if (state === "symlink-correct") return ok(undefined);
    if (state !== "missing") {
      await fs.rm(linkPath, { recursive: true, force: true });
    }

    // Use junction on Windows so directory symlinks don't require elevated
    // privileges or Developer Mode. Behaves identically for our purposes.
    const symlinkType = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(target, linkPath, symlinkType);

    return ok(undefined);
  } catch (e) {
    return err({
      code: RuntimeSymlinkErrorCode.FS_ERROR,
      message: e instanceof Error ? e.message : "Filesystem error",
    });
  }
};

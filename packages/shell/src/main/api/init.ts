import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Overridable for tests / alternate profiles: point ANTIDRAW_ROOT at any
// directory to relocate the DB and workspaces (e2e tests use a tmp dir).
export const antidrawRoot =
  process.env.ANTIDRAW_ROOT ?? path.join(os.homedir(), ".antidraw");

// Ensure root directory exists on module import
if (!fs.existsSync(antidrawRoot)) {
  fs.mkdirSync(antidrawRoot, { recursive: true });
}

// Path helpers
export const getAntidrawRoot = () => antidrawRoot;

export const getWorkspacesPath = () => path.join(antidrawRoot, "workspaces");

export const getWorkspacePath = (id: string) =>
  path.join(antidrawRoot, "workspaces", id);

export const getWorkspaceClaudePath = (id: string) =>
  path.join(getWorkspacePath(id), ".claude");

export const getWorkspaceSourcePath = (id: string) =>
  path.join(getWorkspacePath(id), "source");

export const getDbPath = () => path.join(antidrawRoot, "antidraw.db");

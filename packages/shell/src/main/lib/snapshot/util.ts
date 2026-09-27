import { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import type { FileMode } from "./types";

// Snapshot order: byte order of the UTF-8 path, the same on every platform and locale
export const byteCompare = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

export const toPosix = (p: string): string => (path.sep === "/" ? p : p.split(path.sep).join("/"));

// Native path of a validated snapshot path under `root`
export const nativePath = (root: string, p: string): string => path.join(root, ...p.split("/"));

export const modeOf = (stats: Stats): FileMode => (stats.mode & 0o111 ? 0o755 : 0o644);

export const isInside = (realRoot: string, real: string): boolean => real.startsWith(realRoot + path.sep);

// O_NOFOLLOW refuses a final symlink. win32 has no such flag, so callers lstat first there
export const HAS_NOFOLLOW = fsConstants.O_NOFOLLOW !== undefined;
export const READ_NOFOLLOW = HAS_NOFOLLOW ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW : fsConstants.O_RDONLY;

const errorCode = (e: unknown): string | undefined =>
  e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : undefined;

export const isMissing = (e: unknown): boolean => {
  const code = errorCode(e);
  return code === "ENOENT" || code === "ENOTDIR";
};

export const isDenied = (e: unknown): boolean => {
  const code = errorCode(e);
  return code === "EACCES" || code === "EPERM";
};

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

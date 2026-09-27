import {
  ANY_DEPTH_EXCLUDED_DIRS,
  ROOT_EXCLUDED_DIRS,
  SECRET_DIRS,
  isAlwaysExcludedFile,
  isSensitiveFile,
} from "./types";

const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1024;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

const anyDepthDirs = new Set<string>(ANY_DEPTH_EXCLUDED_DIRS);
const rootDirs = new Set<string>(ROOT_EXCLUDED_DIRS);
const secretDirs = new Set<string>(SECRET_DIRS);

// Relative POSIX path with no empty, "." or ".." segment, no backslash and no control characters.
// Same rule as packages/server/src/lib/paths.ts
export const isSafeSnapshotPath = (p: string): boolean => {
  if (p === "" || p.startsWith("/") || p.includes("\\") || CONTROL_CHARS.test(p)) return false;
  if (Buffer.byteLength(p, "utf8") > MAX_PATH_BYTES) return false;
  return p
    .split("/")
    .every((s) => s !== "" && s !== "." && s !== ".." && Buffer.byteLength(s, "utf8") <= MAX_SEGMENT_BYTES);
};

// Key for case-insensitive collision checks (APFS and NTFS default to case-insensitive)
export const caseKey = (p: string): string => p.normalize("NFC").toLowerCase();

// Groups of paths that differ only by case or Unicode normalization, each sorted by bytes
export const findCaseCollisions = (paths: string[]): string[][] => {
  const byKey = new Map<string, string[]>();
  for (const p of paths) {
    const key = caseKey(p);
    const group = byKey.get(key);
    if (group) group.push(p);
    else byKey.set(key, [p]);
  }
  return [...byKey.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
};

// Why scan would never put `p` in a snapshot, whatever the .gitignore files say; null when it may.
// Segments are compared case-insensitively. `isDir` marks `p` itself as a directory, so a root
// `dist` directory is excluded while a root file named `dist` is not
export const snapshotExclusionReason = (p: string, isDir = false): "always-excluded" | "secret" | null => {
  const segments = p.split("/");
  let reason: "always-excluded" | "secret" | null = null;
  for (const [i, segment] of segments.entries()) {
    const lower = segment.toLowerCase();
    if (secretDirs.has(lower) || isSensitiveFile(segment)) return "secret";
    if (
      anyDepthDirs.has(lower) ||
      (i === 0 && (segments.length > 1 || isDir) && rootDirs.has(lower)) ||
      isAlwaysExcludedFile(segment)
    ) {
      reason = "always-excluded";
    }
  }
  return reason;
};

// The single predicate shared by scan, stage and extract (mirrors the server's isExcludedSnapshotPath)
export const isExcludedSnapshotPath = (p: string): boolean => snapshotExclusionReason(p) !== null;

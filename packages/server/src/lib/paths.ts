// Path rules for publish requests. The snapshot rules are the same as the
// app's (packages/shell src/main/lib/snapshot/paths.ts); neither package
// imports the other, and both run the same test table.

const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1024;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

const encoder = new TextEncoder();
export const utf8Bytes = (s: string) => encoder.encode(s).length;

// Relative POSIX path: not empty, no leading "/", no backslash, no control
// characters (NUL included), and no empty, "." or ".." segment. Each segment
// is at most 255 UTF-8 bytes and the whole path at most 1024.
export const isSafeSnapshotPath = (p: string): boolean => {
  if (p === "" || p.startsWith("/") || p.includes("\\") || CONTROL_CHARS.test(p)) return false;
  if (utf8Bytes(p) > MAX_PATH_BYTES) return false;
  return p
    .split("/")
    .every((s) => s !== "" && s !== "." && s !== ".." && utf8Bytes(s) <= MAX_SEGMENT_BYTES);
};

// A name as a case-insensitive filesystem compares it. APFS uses full Unicode
// case folding, which toLowerCase alone misses: "ſ" (long s) and "ß" fold to
// "s"/"ss", so `node_moduleſ` opens `node_modules`. Upper-then-lower applies
// those foldings; over-folding only refuses more. Same as the app's foldName.
export const foldName = (s: string): string =>
  s.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");

export const caseKey = (p: string): string => foldName(p);

const ANY_DEPTH_EXCLUDED_DIRS = new Set([
  ".git",
  ".claude",
  ".vercel",
  "node_modules",
  ".ssh",
  ".aws",
  ".gnupg",
]);
// Build output, excluded at the workspace root only.
const ROOT_EXCLUDED_DIRS = new Set(["dist", "out", ".vite"]);

const isAlwaysExcludedFile = (name: string) =>
  /^\.env/i.test(name) || name.toLowerCase() === ".ds_store";

const SENSITIVE_NAMES = new Set([".npmrc", ".yarnrc.yml", ".netrc", ".git-credentials", ".pypirc"]);
// No `*.key`: it also matches Keynote files.
const SENSITIVE_PATTERNS = [
  /^\.dev\.vars/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
];
const isSensitiveFile = (name: string) =>
  SENSITIVE_NAMES.has(name.toLowerCase()) || SENSITIVE_PATTERNS.some((re) => re.test(name));

// True when the app's scan would never put `p` in a snapshot, whatever the
// .gitignore files say. Remix refuses such a snapshot (a hand-built one could
// carry .claude hooks or .git/config), so begin refuses such a large-file path
// up front rather than accept a publish nobody can remix.
export const isExcludedSnapshotPath = (p: string): boolean => {
  const segments = p.split("/");
  return segments.some((segment, i) => {
    // Compared as the filesystem folds it (foldName): a /i regex misses ſ too.
    const folded = foldName(segment);
    return (
      ANY_DEPTH_EXCLUDED_DIRS.has(folded) ||
      (i === 0 && segments.length > 1 && ROOT_EXCLUDED_DIRS.has(folded)) ||
      isAlwaysExcludedFile(folded) ||
      isSensitiveFile(folded)
    );
  });
};

export const ENTRY_PATHS = ["preview.html", "canvas.json", "index.html"] as const;
export type EntryPath = (typeof ENTRY_PATHS)[number];
const entrySet = new Set<string>(ENTRY_PATHS);
export const HASHED_FILES = ".hashed-files.json";
const MAX_SITE_KEY_BYTES = 1024;
// A slug is one DNS label. Begin checks paths before it knows the site's slug,
// so the key length is checked against the longest one.
const MAX_SLUG_BYTES = 63;

// A non-entry file a site may serve. The publish Worker serves any key under
// <slug>/, so this is the only dotfile gate: a dot segment is allowed only as
// a leading `.well-known`, or anywhere in hashed build output under assets/
// (a component named `.Dot.tsx` builds to assets/.Dot-<hash>.js).
export const isPublishableSitePath = (p: string, immutable: boolean): boolean => {
  if (!isSafeSnapshotPath(p)) return false;
  if (MAX_SLUG_BYTES + 1 + utf8Bytes(p) > MAX_SITE_KEY_BYTES) return false;
  if (entrySet.has(p) || p === HASHED_FILES) return false;
  const hashedAsset = immutable && p.startsWith("assets/");
  return p
    .split("/")
    .every(
      (segment, i) =>
        !segment.startsWith(".") || (i === 0 && segment === ".well-known") || hashedAsset,
    );
};

// Snapshot constants and types, shared by scan, stage, pack and extract.
// The limits mirror packages/server/src/lib/publish-limits.ts; neither package imports the other.

export const LARGE_FILE_BYTES = 1024 * 1024; // a file >= this is uploaded as a separate blob
export const MAX_SNAPSHOT_BYTES = 500 * 1024 * 1024; // archive size + distinct blob sizes
export const MAX_UNCOMPRESSED_BYTES = MAX_SNAPSHOT_BYTES * 2; // Σ manifest sizes; publish pre-check = extract guard
export const MAX_SNAPSHOT_FILES = 100_000; // publish pre-check = extract guard
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024; // manifest.json tar entry, checked before buffering

export type FileMode = 0o644 | 0o755;

export const ANY_DEPTH_EXCLUDED_DIRS = [".git", ".claude", ".vercel", "node_modules", ".ssh", ".aws", ".gnupg"] as const;
// Credential directories: reported with reason "secret" rather than "always-excluded"
export const SECRET_DIRS = [".ssh", ".aws", ".gnupg"] as const;
// Build output: workspace root only. Elsewhere they are ordinary directories (the template
// .gitignore still ignores nested dist/.vite, and `!` can re-include them)
export const ROOT_EXCLUDED_DIRS = ["dist", "out", ".vite"] as const;

// .env, .env.local, .env.production, …; a directory named .env* is excluded too
export const isAlwaysExcludedFile = (name: string): boolean =>
  /^\.env/i.test(name) || name.toLowerCase() === ".ds_store";

const SECRET_NAMES = new Set([".npmrc", ".yarnrc.yml", ".netrc", ".git-credentials", ".pypirc"]);
const SECRET_PATTERNS = [/^\.dev\.vars/i, /\.pem$/i, /\.p12$/i, /\.pfx$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i];

// Credential files. Remix is on by default, so a snapshot is effectively public; these are never
// packed. `*.key` is deliberately absent: it also matches Keynote files.
export const isSensitiveFile = (name: string): boolean =>
  SECRET_NAMES.has(name.toLowerCase()) || SECRET_PATTERNS.some((re) => re.test(name));

export type ScannedFile = {
  path: string;
  absPath: string;
  size: number;
  mode: FileMode;
  viaSymlink: boolean;
  dev: number; // of the regular file read (the target, for a symlink); stage re-checks them
  ino: number;
};

export type ExclusionReason =
  | "always-excluded"
  | "secret"
  | "gitignored"
  | "symlink-outside"
  | "symlink-to-excluded"
  | "symlink-directory"
  | "symlink-broken"
  | "not-a-regular-file"
  | "unsupported-name"
  | "unreadable";

export type Exclusion = { path: string; isDir: boolean; reason: ExclusionReason; rule?: string; ignoreFile?: string };
export type ExclusionGroup = { reason: "gitignored"; ignoreFile: string; rule: string; count: number; examples: string[] };
export type ExclusionReport = { listed: Exclusion[]; grouped: ExclusionGroup[] };

export type SnapshotPlan = { sourceDir: string; files: ScannedFile[]; excluded: ExclusionReport };

export type ManifestEntry = { path: string; size: number; sha256: string; mode: FileMode; storage: "archive" | "blob" };
export type SnapshotManifest = { version: 1; files: ManifestEntry[] };

export type StagedSnapshot = { dir: string; manifest: SnapshotManifest; excluded: ExclusionReport };

export type PackedBlob = { sha256: string; size: number; file: string; paths: string[] };
export type PackedSnapshot = {
  archiveFile: string;
  archiveSha256: string;
  archiveSize: number;
  blobs: PackedBlob[]; // distinct by sha256; file = <blobDir>/<sha256>, a private copy
  snapshotBytes: number; // archiveSize + Σ blobs.size
  uncompressedBytes: number; // Σ manifest sizes (all files)
  fileCount: number; // manifest.files.length
  manifest: SnapshotManifest;
};

export type SnapshotError = {
  code: "SOURCE_MISSING" | "SCAN_FAILED" | "CASE_COLLISION" | "STAGE_FAILED" | "PACK_FAILED" | "CANCELLED";
  message: string;
  paths?: string[][] | string[]; // CASE_COLLISION: groups of colliding paths
};

export type ExtractError = {
  code:
    | "INVALID_ARCHIVE"
    | "UNSAFE_ENTRY"
    | "UNSUPPORTED_ENTRY"
    | "DUPLICATE_ENTRY"
    | "CASE_COLLISION"
    | "MANIFEST_MISMATCH"
    | "CHECKSUM_MISMATCH"
    | "MISSING_BLOB"
    | "TOO_LARGE"
    | "DEST_EXISTS"
    | "WRITE_FAILED";
  message: string;
  path?: string;
};

export type ExtractedSnapshot = { dir: string; manifest: SnapshotManifest; fileCount: number; bytes: number };

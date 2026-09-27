import type { ExclusionReport } from "@/main/lib/snapshot";

// The publish vocabulary shared by main (publish.service, the /api/publish
// controller) and the renderer, which imports these as types only.

// Site limits. They mirror packages/server/src/lib/publish-limits.ts, which is
// the authority; checking them here only saves a begin that would be refused.
// The snapshot limits live with the snapshot code (@/main/lib/snapshot).
export const MAX_SITE_BYTES = 500 * 1024 * 1024; // Σ site files + entries
export const MAX_SITE_FILES = 5_000; // not counting the 3 entries
export const MAX_LARGE_FILES = 1_000; // snapshot paths stored as blobs

// The server's view of a published canvas (GET /api/publish/sites).
export type SiteStatus = {
  siteId: string;
  slug: string;
  url: string;
  headVersion: number; // 0 = never completed
  allowRemix: boolean; // the server-owned setting remix checks
  lastPublishedAt: string | null;
};

export type PublishStep =
  | "checking"
  | "snapshot"
  | "building"
  | "uploading"
  | "finishing";

export type PublishErrorCode =
  | "SIGNED_OUT"
  | "SERVER_UNREACHABLE"
  | "SERVER_ERROR"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_BUSY"
  | "PUBLISH_IN_PROGRESS"
  | "CASE_COLLISION"
  | "SNAPSHOT_FAILED"
  | "PUBLISH_TOO_LARGE"
  | "SITE_TOO_LARGE"
  | "QUOTA_EXCEEDED"
  | "SITE_LIMIT"
  | "DEPENDENCIES_MISSING"
  | "BUILD_FAILED"
  | "UPLOAD_FAILED"
  | "PUBLISH_CONFLICT"
  | "PUBLISH_EXPIRED"
  | "PUBLISH_OUTCOME_UNKNOWN"
  | "RATE_LIMITED"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export type PublishErrorDetails = {
  largestFiles?: { path: string; size: number }[]; // PUBLISH_TOO_LARGE, QUOTA_EXCEEDED
  quotaBytes?: number;
  usedBytes?: number;
  publishBytes?: number;
  limitBytes?: number;
  snapshotBytes?: number;
  uncompressedBytes?: number; // PUBLISH_TOO_LARGE (local pre-check)
  fileCount?: number;
  largeFileCount?: number; // PUBLISH_TOO_LARGE (too many blob paths)
  siteFileCount?: number; // SITE_TOO_LARGE
  siteBytes?: number;
  collisions?: string[][]; // CASE_COLLISION
  paths?: string[]; // SNAPSHOT_FAILED from server INVALID_PATH / STAGE_FAILED
  logTail?: string[]; // BUILD_FAILED
  timedOut?: boolean; // BUILD_FAILED from BUILD_TIMEOUT
  siteLimit?: number; // SITE_LIMIT
  serverCode?: string; // INTERNAL_ERROR / SERVER_ERROR: the server's own code
  publishId?: string; // PUBLISH_OUTCOME_UNKNOWN: the session "Check status" asks about
  // Any failure after uploads started: public files (fixed names such as
  // /logo.png) go live as they upload, before the pages switch over.
  publicFilesMayHaveChanged?: boolean;
};

export type PublishError = {
  code: PublishErrorCode;
  message: string;
  details?: PublishErrorDetails;
};

// Things the user should know about a publish that succeeded.
export type PublishNote = {
  // .env* files are never snapshotted, so the site build does not see them
  // either: VITE_* values from them are not in the published site.
  code: "ENV_FILES_EXCLUDED";
  message: string;
  paths: string[];
};

export type PublishResult = {
  url: string;
  slug: string;
  version: number;
  allowRemix: boolean;
  status: SiteStatus; // what GET /api/publish/:ws now answers
  snapshot: {
    fileCount: number;
    archiveBytes: number;
    largeFileCount: number;
    snapshotBytes: number;
  };
  site: { fileCount: number; uploadedFiles: number; skipped: string[] };
  excluded: ExclusionReport;
  notes: PublishNote[];
};

export type PublishEvent =
  | { type: "step"; step: PublishStep }
  | { type: "build-log"; line: string }
  | {
      type: "upload-progress";
      uploadedBytes: number;
      totalBytes: number;
      uploadedFiles: number;
      totalFiles: number;
    }
  | { type: "done"; result: PublishResult }
  | { type: "error"; error: PublishError };

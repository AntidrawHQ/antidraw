import { z } from "zod";
import {
  LARGE_FILE_BYTES,
  MAX_LARGE_FILES,
  MAX_SITE_FILES,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_FILES,
  MAX_UNCOMPRESSED_BYTES,
} from "./publish-limits";
import { ENTRY_PATHS, isSafeSnapshotPath } from "./paths";

// The wire contract of /api/publish/* and /api/remix. The app mirrors these
// in packages/shell src/main/services/publish/cloud-publish.ts.

export { ENTRY_PATHS };
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export const fileMode = z.union([z.literal(0o644), z.literal(0o755)]); // JSON: 420 | 493
const contentType = z
  .string()
  .max(128)
  .regex(/^[\w.+-]+\/[\w.+-]+(?:; ?charset=[\w-]+)?$/);

export const largeFileSchema = z.object({
  // Excluded paths are refused in the service (422 INVALID_PATH, with details).
  path: z.string().min(1).max(1024).refine(isSafeSnapshotPath, "invalid path"),
  sha256: sha256Hex,
  size: z.number().int().min(LARGE_FILE_BYTES).max(MAX_SNAPSHOT_BYTES),
  mode: fileMode,
});

// Every file of the site, the entry pages (ENTRY_PATHS) included. Its
// content is stored once per account, at c/<userId>/<sha256>.
export const siteFileSchema = z.object({
  path: z.string().min(1).max(900), // isPublishableSitePath in the service
  sha256: sha256Hex,
  size: z.number().int().nonnegative(),
  contentType, // what the publish Worker serves it as
  // The build hashed its name. Only the dotfile gate reads it; the publish
  // Worker decides caching from the path (isImmutableSitePath).
  immutable: z.boolean(),
});

export const beginPublishRequest = z.object({
  clientWorkspaceId: z.uuid(), // the app's local workspace id
  name: z.string().trim().min(1).max(100), // workspace name (slug base, remix display)
  // Optional, no default. Present: the user changed the setting, and begin
  // stores it on the site. Absent: the site keeps its value (true when new).
  allowRemix: z.boolean().optional(),
  snapshot: z.object({
    source: z.object({
      sha256: sha256Hex,
      size: z.number().int().positive().max(MAX_SNAPSHOT_BYTES),
    }),
    largeFiles: z.array(largeFileSchema).max(MAX_LARGE_FILES),
    fileCount: z.number().int().nonnegative().max(MAX_SNAPSHOT_FILES), // all manifest files
    uncompressedBytes: z.number().int().nonnegative().max(MAX_UNCOMPRESSED_BYTES), // Σ sizes
  }),
  site: z.object({
    files: z.array(siteFileSchema).max(MAX_SITE_FILES),
  }),
});
export type BeginPublishRequest = z.infer<typeof beginPublishRequest>;

export const uploadInstruction = z.object({
  kind: z.enum(["source", "blob", "site"]),
  sha256: sha256Hex,
  size: z.number().int().nonnegative(),
  // Kind "site": one of the site paths with this content (a content is
  // uploaded once, however many paths share it).
  path: z.string().optional(),
  url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()), // send verbatim; lowercase names
});
export type UploadInstruction = z.infer<typeof uploadInstruction>;

export const siteStatus = z.object({
  siteId: z.string(),
  slug: z.string(),
  url: z.string().url(),
  headVersion: z.number().int().nonnegative(), // 0 = never completed
  allowRemix: z.boolean(), // site.allow_remix, the server-owned setting
  lastPublishedAt: z.string().datetime().nullable(),
});
export type SiteStatus = z.infer<typeof siteStatus>;

export const beginPublishResponse = z.object({
  publish: z.object({
    id: z.string(),
    siteId: z.string(),
    slug: z.string(),
    url: z.string().url(),
    baseVersion: z.number().int().nonnegative(),
    expiresAt: z.string().datetime(),
  }),
  uploads: z.array(uploadInstruction), // only objects the server does not have
});
export type BeginPublishResponse = z.infer<typeof beginPublishResponse>;

// Nothing: every file, entry pages included, was uploaded. Complete switches
// the site over by writing its pointer once the version is committed.
export const completePublishRequest = z.object({});
export type CompletePublishRequest = z.infer<typeof completePublishRequest>;

export const completePublishResponse = z.object({
  site: siteStatus,
  version: z.number().int().positive(),
});
export type CompletePublishResponse = z.infer<typeof completePublishResponse>;

// GET /api/publish/sessions/:id
export const publishSessionResponse = z.object({
  status: z.enum(["pending", "completed", "aborted", "expired"]),
  resultVersion: z.number().int().positive().nullable(),
  site: siteStatus,
});
export type PublishSessionResponse = z.infer<typeof publishSessionResponse>;

export const siteStatusQuery = z.object({ clientWorkspaceId: z.uuid() });
export const siteStatusResponse = z.object({ site: siteStatus.nullable() });
export const patchSiteRequest = z.object({ allowRemix: z.boolean() });

export const remixRequest = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
});
export const remixResponse = z.object({
  remix: z.object({
    slug: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    source: z.object({ sha256: sha256Hex, size: z.number().int(), url: z.string().url() }),
    largeFiles: z.array(
      z.object({
        path: z.string(),
        sha256: sha256Hex,
        size: z.number().int(),
        mode: fileMode,
        url: z.string().url(),
      }),
    ),
  }),
});
export type RemixResponse = z.infer<typeof remixResponse>;

// What begin stores in publish_session.plan, read back by complete and GC.
export const storedPlan = z.object({
  name: z.string(),
  source: z.object({ sha256: sha256Hex, size: z.number().int() }),
  largeFiles: z.array(largeFileSchema),
  fileCount: z.number().int(),
  uncompressedBytes: z.number().int(),
  site: z.object({ files: z.array(siteFileSchema) }),
});
export type StoredPlan = z.infer<typeof storedPlan>;

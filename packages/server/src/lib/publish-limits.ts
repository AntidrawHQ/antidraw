// Limits and timings for publish + remix. The snapshot limits are mirrored by
// the app (packages/shell src/main/lib/snapshot/types.ts, and the site limits
// in src/main/services/publish/types.ts), which checks them before it uploads
// anything; the server's checks are the backstop.

const MiB = 1024 * 1024;

// A snapshot file this size or larger is stored as its own blob, outside the
// source archive.
export const LARGE_FILE_BYTES = MiB;
// Source archive plus distinct blob sizes.
export const MAX_SNAPSHOT_BYTES = 500 * MiB;
// Σ size of every manifest entry: the app's extract guard, so anything that
// publishes can be remixed.
export const MAX_UNCOMPRESSED_BYTES = MAX_SNAPSHOT_BYTES * 2;
export const MAX_SNAPSHOT_FILES = 100_000;
// Per account: every stored object that GC has not claimed.
export const QUOTA_BYTES = 1024 * MiB;
// Site files plus entries. Not counted in the quota, but capped.
export const MAX_SITE_BYTES = 500 * MiB;
// Not counting the three entries.
export const MAX_SITE_FILES = 5_000;
export const MAX_SITES_PER_ACCOUNT = 50;
export const MAX_ENTRY_BYTES = 2 * MiB;
export const MAX_LARGE_FILES = 1_000;
// D1 stores at most 2 MB per value.
export const MAX_PLAN_JSON_BYTES = 1_500_000;
// A larger protected_files union collapses to "*".
export const MAX_PROTECTED_JSON_BYTES = 1_800_000;

export const KEEP_VERSIONS = 5;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
// Equal to the session TTL, so a queued PUT never meets an expired URL while
// its session is valid, and every URL expires by the session's hold_until.
export const UPLOAD_URL_TTL_S = SESSION_TTL_MS / 1000;
export const COMPLETE_LOCK_TTL_MS = 10 * 60 * 1000;
// Complete writes entries only while its lock has at least this long left.
export const COMPLETE_FENCE_MS = 60 * 1000;
export const DOWNLOAD_URL_TTL_S = 600;
export const GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const GC_LOCK_TTL_MS = 5 * 60 * 1000;
export const GC_OBJECTS_PER_RUN = 500;
export const GC_SITES_PER_RUN = 50;
export const GC_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const GC_ABANDONED_SITE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Stale site keys stay this long after a switch-over or a session's hold.
export const SITE_CLEANUP_DELAY_MS = 60 * 60 * 1000;
// R2 deletes at most 1 000 keys per call.
export const R2_DELETE_BATCH = 1_000;
// D1's per-statement bound-parameter limit (also inside a batch).
export const D1_MAX_PARAMS = 100;

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

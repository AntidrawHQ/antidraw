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
// Per account: the site bytes begin has handed out upload URLs for, summed
// over the account's uncommitted sessions whose hold has not ended. Site files
// land on their live keys and are outside QUOTA_BYTES, so without this a
// client could park any amount there until GC removes it.
export const MAX_PENDING_SITE_BYTES = 1024 * MiB;
// Per account: sessions that are not completed and still hold (their upload
// URLs work). Each keeps a plan of up to MAX_PLAN_JSON_BYTES in D1 and in GC's
// memory while it holds.
export const MAX_OPEN_SESSIONS_PER_ACCOUNT = 10;
// Site files plus entries. Not counted in the quota, but capped.
export const MAX_SITE_BYTES = 500 * MiB;
// Not counting the three entries.
export const MAX_SITE_FILES = 5_000;
export const MAX_SITES_PER_ACCOUNT = 50;
// What one site may keep under <slug>/ once a begin's uploads land: the live
// version, one full replacement, and room for stale files GC has not reached.
// MAX_SITE_BYTES and MAX_SITE_FILES bound one plan; this bounds the prefix.
export const MAX_SITE_STORED_BYTES = 2 * MAX_SITE_BYTES;
export const MAX_SITE_STORED_FILES = 2 * (MAX_SITE_FILES + 3);
export const MAX_ENTRY_BYTES = 2 * MiB;
export const MAX_LARGE_FILES = 1_000;
// D1 stores at most 2 MB per value.
export const MAX_PLAN_JSON_BYTES = 1_500_000;
// A larger protected_files union collapses to "*".
export const MAX_PROTECTED_JSON_BYTES = 1_800_000;
// D1 refuses a row whose record is over 2 000 000 bytes (SQLITE_MAX_LENGTH
// applies to the whole record, not each value). live_files and
// protected_files share the site row, so together they stay under this,
// leaving room for the row's other columns.
export const MAX_SITE_ROW_PATHS_BYTES = 1_900_000;

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
// GC runs hourly (wrangler.jsonc). Each run stops starting new work after
// this long, leaving the rest for the next hour; a cron invocation may run for
// 15 minutes.
export const GC_RUN_BUDGET_MS = 10 * 60 * 1000;
// Objects claimed per run (leftovers included), deleted from R2 in batches
// of R2_DELETE_BATCH: 10 R2 calls and about 320 D1 statements.
export const GC_OBJECTS_PER_RUN = 10_000;
// Stale-site visits per run, and, separately, abandoned sites deleted.
export const GC_SITES_PER_RUN = 50;
export const GC_ABANDONED_SITES_PER_RUN = 20;
// Keys one site visit lists, and all visits of a run together; a visit that
// reaches either leaves the site due, and the next run continues.
export const GC_SITE_KEYS_PER_VISIT = 20_000;
export const GC_SITE_KEYS_PER_RUN = 100_000;
// A site whose cleanup has been wanted this long is visited even when begins
// and commits keep pushing cleanup_after out.
export const GC_MAX_CLEANUP_DEFER_MS = 24 * 60 * 60 * 1000;
// Sessions retired (hold ended: plan stubbed, held objects dropped) or
// deleted per statement, and statements per run for each (about 1 900 an
// hour). With the other steps' limits a run stays under ~900 D1 statements,
// within Workers Paid's 1 000 per invocation.
export const GC_SESSIONS_PER_STATEMENT = 97;
export const GC_SESSION_STATEMENTS_PER_RUN = 20;
export const GC_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// A session that never committed is forgotten this long after it expired.
export const GC_UNCOMMITTED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const GC_ABANDONED_SITE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A protected_files "*" GC cannot resolve (a live entry file matches neither
// the head's entries nor any remaining session plan) stops protecting that
// entry's references once the entry is this old: a site left half-published
// that long gives up the files only that entry used, so its junk is removed.
export const GC_UNRESOLVED_ENTRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Stale site keys stay this long after a switch-over or a session's hold.
export const SITE_CLEANUP_DELAY_MS = 60 * 60 * 1000;
// R2 deletes at most 1 000 keys per call.
export const R2_DELETE_BATCH = 1_000;
// D1's per-statement bound-parameter limit (also inside a batch).
export const D1_MAX_PARAMS = 100;

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

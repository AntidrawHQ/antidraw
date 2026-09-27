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
// Per account: the bytes of site contents no commit has verified, summed over
// the account's uncommitted sessions whose hold has not ended. Site contents
// are outside QUOTA_BYTES, so without this a client could park any amount of
// them until GC removes them.
export const MAX_PENDING_SITE_BYTES = 1024 * MiB;
// Per account: every site content GC has not claimed, committed or not (what
// retained versions list, what sessions hold, and what waits out GC's age
// floor after the versions that listed it were pruned). Site contents are
// append-only and outside QUOTA_BYTES, so without this an account could keep
// 50 sites x KEEP_VERSIONS x MAX_SITE_BYTES referenced, and churn fresh
// contents through commits faster than GC collects them. Begin refuses a
// publish that adds site bytes past it.
export const MAX_STORED_SITE_BYTES = 4096 * MiB;
// Per account: the D1 footprint of retained site-file rows (version_site_file),
// estimated per row as its path and content type bytes plus
// SITE_FILE_ROW_OVERHEAD_BYTES (the sha256, ids, size and both indexes). A
// version keeps every row while its site's pointer may still be at it, and
// after that only the rows a pointer's grace entries can use, but an account
// can make every path look immutable: this bounds what its retained versions
// keep in the database the auth tables share. Begin checks it, so concurrent
// begins can pass it together by at most MAX_OPEN_SESSIONS_PER_ACCOUNT plans.
export const MAX_SITE_FILE_ROW_BYTES = 64 * MiB;
export const SITE_FILE_ROW_OVERHEAD_BYTES = 256;
// Per account: sessions that are not completed and still hold (their upload
// URLs work). Each keeps a plan of up to MAX_PLAN_JSON_BYTES in D1.
export const MAX_OPEN_SESSIONS_PER_ACCOUNT = 10;
// Σ size of a site's files, entry pages included. Not counted in the quota,
// but capped.
export const MAX_SITE_BYTES = 500 * MiB;
// Site files, entry pages included.
export const MAX_SITE_FILES = 5_000;
export const MAX_SITES_PER_ACCOUNT = 50;
export const MAX_LARGE_FILES = 1_000;
// D1 stores at most 2 MB per value. The plan lists every site file with more
// than the pointer says about it, so this also keeps a head version's pointer
// entries under MAX_POINTER_BYTES.
export const MAX_PLAN_JSON_BYTES = 1_500_000;
// A site's pointer (m/<slug>.json) stays about this size: grace entries of
// older versions are dropped, oldest first, past it.
export const MAX_POINTER_BYTES = 2_000_000;
// A bulk statement binds its rows as one JSON array (json_each) of at most
// this many bytes, under D1's 2 000 000 bytes per value.
export const D1_JSON_PARAM_BYTES = 1_000_000;

export const KEEP_VERSIONS = 5;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
// Equal to the session TTL, so a queued PUT never meets an expired URL while
// its session is valid, and every URL expires by the session's hold_until.
export const UPLOAD_URL_TTL_S = SESSION_TTL_MS / 1000;
export const COMPLETE_LOCK_TTL_MS = 10 * 60 * 1000;
export const DOWNLOAD_URL_TTL_S = 600;
export const GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const GC_LOCK_TTL_MS = 5 * 60 * 1000;
// The cron trigger (wrangler.jsonc, src/scheduled.ts): GC runs hourly.
export const GC_CRON = "17 * * * *";
// GC and the Worker completing a publish each judge a session's hold by their
// own clock. GC treats a hold as ended only this long after its hold_until
// (claiming its unverified objects, retiring it), so a complete whose clock lags GC's by less still finds everything
// its commit guard checks where it left it.
export const GC_CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000;
// GC runs hourly (GC_CRON). Each run stops starting new work after this
// long, leaving the rest for the next hour; a cron invocation may run for
// 15 minutes.
export const GC_RUN_BUDGET_MS = 10 * 60 * 1000;
// Objects claimed per run (leftovers included), deleted from R2 in batches
// of R2_DELETE_BATCH (one call per bucket a batch touches): at most 20 R2
// calls and about 320 D1 statements.
export const GC_OBJECTS_PER_RUN = 10_000;
// Sites whose pointer is behind their head version re-synced per run (a
// complete whose pointer write failed), and abandoned sites deleted.
export const GC_POINTER_SYNCS_PER_RUN = 50;
export const GC_ABANDONED_SITES_PER_RUN = 20;
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
// R2 deletes at most 1 000 keys per call.
export const R2_DELETE_BATCH = 1_000;
// D1's per-statement bound-parameter limit (also inside a batch).
export const D1_MAX_PARAMS = 100;

// Limits and timings for publish + remix. The snapshot limits are mirrored by
// the app (packages/shell src/main/lib/snapshot/types.ts, and the site limits
// in src/main/services/publish/types.ts), which checks them before it uploads
// anything; the server's checks are the backstop.

/*
 * D1 footprint audit. The publish tables share one D1 database (10 GB hard
 * limit) with better-auth's, so what one signed-in account can make them keep
 * must be small and bounded, whatever it sends. Every row below is inserted by
 * begin, or by a commit whose rows begin reserved; complete, abort, status,
 * the allow-remix PATCH and remix only read, update or delete, and GC never
 * inserts. Begin estimates the account's rows (accountRowBytes in
 * publish.store.ts: the per-row sizes below, measured with dbstat) and refuses
 * a publish that would take them past MAX_ACCOUNT_ROW_BYTES, before it inserts
 * anything and again after (so concurrent begins cannot pass together). Rows
 * GC has not removed yet still count, so a GC backlog makes the account wait,
 * never the database grow. Per account: at most 48 MiB estimated (the tests
 * drive each table's cheapest abuse loop to the cap, and check D1's real size
 * stays under the estimate), so 100 abusive accounts stay under 5 GB.
 *
 * site: begin, for a new workspace (at most MAX_SITES_PER_ACCOUNT). ~460 B
 *   (name up to 100 chars), counted SITE_ROW_BYTES. Lives until GC deletes it
 *   as abandoned (never committed, 7 days old, no session left) or the
 *   account goes. Worst case 50 x 640 B.
 * publish_session: begin, one per begin (the rate limiter allows 20 a
 *   minute); a refused begin deletes its own. ~310 B plus its plan (up to
 *   MAX_PLAN_JSON_BYTES) until a commit, a no-upload abort or GC's retire
 *   stubs the plan. The commit deletes completed sessions whose version was
 *   pruned; GC deletes completed ones after 7 days and uncommitted ones a day
 *   after they expire (once retired), GC_SESSIONS_PER_STATEMENT at a time.
 *   Counted SESSION_ROW_BYTES plus the plan, plus the rows the plan reserves
 *   for its version until the commit. Without the account cap: ~31 000 rows
 *   in the day an aborted session lives.
 * publish_session_object: begin, one per plan object (a source, up to
 *   MAX_LARGE_FILES blobs and MAX_SITE_FILES contents: 6 001). ~400 B,
 *   counted SESSION_OBJECT_ROW_BYTES. Deleted by the commit, a no-upload
 *   abort, or GC's retire once the hold ended (GC_SESSION_OBJECTS_PER_STATEMENT
 *   at a time). Without the account cap: 10 open sessions x 6 001, plus every
 *   session whose hold ended that GC has not retired.
 * stored_object: begin's upsert, one per plan object the account has no row
 *   for (up to 6 001 a begin, whatever their bytes: a site content may be 1
 *   byte); the commit only updates. ~270 B, counted OBJECT_ROW_BYTES. A
 *   refused begin deletes the rows it created. GC deletes unverified rows no
 *   session holds, and verified ones no retained version references a day
 *   after their last commit (GC_OBJECTS_PER_RUN a run for all accounts
 *   together). Without the account cap: 6 001 x 20 begins a minute, as fast
 *   as GC can collect from every account together.
 * site_version: the commit, one per version. ~450 B, counted
 *   VERSION_ROW_BYTES (reserved at begin). The commit prunes its site's
 *   versions past KEEP_VERSIONS (keep=1 excepted); GC prunes the rest
 *   GC_VERSIONS_PER_STATEMENT at a time; a site delete cascades. Without the
 *   account cap: 50 sites x KEEP_VERSIONS, plus kept ones.
 * version_site_file: the commit, one per site file (MAX_SITE_FILES, path up
 *   to 900 B, content type up to 128 B). Measured 310 B plus the path twice
 *   (row and primary key) plus the content type; counted siteFileRowBytes
 *   (up to 3 340 B a row, 16.7 MB a version) in its version's
 *   file_row_bytes, reserved at begin. The pointer moving past a version
 *   deletes its rows that no grace entry can use (at most KEEP_VERSIONS x
 *   MAX_SITE_FILES rows a move); the rest go with the version.
 * version_large_file: the commit, one per large file (MAX_LARGE_FILES, path
 *   up to 1 024 B: an index key that long spills into an overflow page of its
 *   own). Measured up to ~6 200 B; counted largeFileRowBytes (up to 7 552 B a
 *   row, 7.5 MB a version), reserved at begin. Lives with its version.
 * Rate limits are Workers rate-limit bindings: nothing in D1.
 *
 * GC (gc.service.ts) acts on a bounded number of rows per statement,
 * cascades included: sessions expired, versions pruned, objects claimed and
 * deleted, session objects dropped and sessions retired or deleted, and sites
 * deleted (only once no session is left, so the delete cascades to nothing).
 */

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
// Per account: the estimated D1 footprint of everything publish keeps for it
// (see the audit at the top of this file). Begin checks it before it inserts
// anything and again after, so concurrent begins cannot pass it together. The
// per-row estimates below were measured with dbstat on SQLite's 4 KiB pages
// (random keys leave B-tree pages about 70% full) and rounded up.
export const MAX_ACCOUNT_ROW_BYTES = 48 * MiB;
// A stored_object row, with its primary-key and created_at index entries.
export const OBJECT_ROW_BYTES = 320;
// A publish_session_object row, with its two index entries.
export const SESSION_OBJECT_ROW_BYTES = 448;
// A publish_session row and its four index entries, apart from its plan.
export const SESSION_ROW_BYTES = 512;
// A site_version row and its three index entries, apart from its file rows.
export const VERSION_ROW_BYTES = 512;
// A site row (name up to 100 characters) and its three index entries.
export const SITE_ROW_BYTES = 640;
// A version_site_file or version_large_file row, apart from its path (stored
// in the row and again in the primary-key index: counted three times for the
// slack) and a site file's content type (counted twice).
export const FILE_ROW_OVERHEAD_BYTES = 384;
// An index key longer than about 1 000 bytes spills into an overflow page of
// its own: a large-file path this long costs a page more (site file paths are
// at most 900 bytes).
export const FILE_KEY_INLINE_BYTES = 900;
export const PAGE_BYTES = 4096;
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
// Unverified objects one begin HEADs, largest first, to find bytes an
// earlier, uncommitted session uploaded; the rest of them are asked for again.
// Bounds the R2 calls a begin makes. Every refusal that needs only D1 rows
// runs before these, so a refused begin makes none.
export const MAX_BEGIN_HEADS = 200;
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
// Objects claimed per run (leftovers included), GC_OBJECTS_PER_CLAIM per
// claim statement, deleted from R2 in batches of R2_DELETE_BATCH (one call per
// bucket a batch touches) and from D1 in one statement per batch: at most 80
// R2 calls and about 90 D1 statements.
export const GC_OBJECTS_PER_RUN = 40_000;
export const GC_OBJECTS_PER_CLAIM = 10_000;
// Sites whose pointer is behind their head version re-synced per run (a
// complete whose pointer write failed), and abandoned sites deleted.
export const GC_POINTER_SYNCS_PER_RUN = 50;
export const GC_ABANDONED_SITES_PER_RUN = 20;
// Sessions expired, retired (hold ended: plan stubbed, held objects dropped)
// or deleted per statement, and statements per run for each (about 1 900 an
// hour). With the other steps' limits a run stays under ~500 D1 statements,
// within Workers Paid's 1 000 per invocation.
export const GC_SESSIONS_PER_STATEMENT = 97;
export const GC_SESSION_STATEMENTS_PER_RUN = 20;
// Retiring a session deletes its session objects (up to ~6 000): at most this
// many per statement, so one statement never deletes an unbounded number.
export const GC_SESSION_OBJECTS_PER_STATEMENT = 10_000;
// Versions GC prunes per statement (each takes its file rows with it, up to
// 6 000), and statements per run. A commit prunes its own site's old versions,
// so GC only meets the ones a keep flag or a failed commit left.
export const GC_VERSIONS_PER_STATEMENT = 10;
export const GC_VERSION_STATEMENTS_PER_RUN = 20;
export const GC_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// A session that never committed is forgotten this long after it expired.
export const GC_UNCOMMITTED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const GC_ABANDONED_SITE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// R2 deletes at most 1 000 keys per call.
export const R2_DELETE_BATCH = 1_000;
// D1's per-statement bound-parameter limit (also inside a batch).
export const D1_MAX_PARAMS = 100;

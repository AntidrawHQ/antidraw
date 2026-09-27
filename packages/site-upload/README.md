# @antidraw/site-upload

Publishes a static-site folder (a build's `dist`) to R2 and serves it. Modelled
on how `wrangler deploy` uploads Workers static assets: hash every file, ask
the server which hashes it lacks, upload only those, then switch the site over
in one write.

```
client (Node)                         server (Worker + R2)
─────────────                         ────────────────────
buildManifest(dir)   ── POST plan ──▶ store.plan      → { missing }
upload missing       ── PUT files/h ▶ store.putFile   R2 checks sha256 on write
                     ── POST commit ▶ store.commit    one pointer write
                                      store.cleanup   drop unneeded files
                                      SiteServer      serve GET / HEAD / Range
```

## Entry points

| Import | Runs in | Contents |
| --- | --- | --- |
| `@antidraw/site-upload/client` | Node / Electron main | `uploadSite`, `createHttpTransport`, `buildManifest` |
| `@antidraw/site-upload/server` | Workers | `SiteStore`, `handleUpload`, `SiteServer` |
| `@antidraw/site-upload/protocol` | both | manifest types and validation, `SiteUploadError`, limits |

The package ships TypeScript source; consumers bundle it (wrangler, Vite).

## R2 layout

```
<prefix>/<site>/f/<sha256>          file bytes, shared by every version of the site
<prefix>/<site>/m/<publishId>.json  one publish's manifest (its plan)
<prefix>/<site>/current.json        the live manifest; swapping it publishes
```

**What stays servable.** The live version, plus the previous version's
immutable files (`i: true`, i.e. hashed build output) that the live version
dropped, so a page opened before a publish can still load its chunks. Nothing
older, and not the previous version's HTML. Cleanup keeps exactly these files,
plus those of any plan still inside its 1-hour upload window.

**Commit retries.** Repeating a commit is safe while it's still the latest one:
it returns `alreadyCommitted: true`. Once a newer publish has gone live, a
replayed commit gets `SUPERSEDED` instead of rolling the site back.

## Serving and caching

`SiteServer` reads a site's `current.json` (kept in memory for 5 s, one read
shared by concurrent requests, 32 MiB of pointers at most; a pointer is under
4 MiB at the default limits, so at least 8 fit), maps the URL to a
file, and answers ETag/304 and single-range requests itself. It never throws:
storage failures become a 503 with `retry-after`.

Pass `cache: caches.default` to read file bytes through the Workers Cache API,
keyed by hash so an entry never goes stale; a miss fills it once per isolate
after the response, through `ctx.waitUntil`. Leave it off on workers.dev,
where the Cache API keeps nothing. Content types come from the `mime` package,
as in Cloudflare's own static-asset serving.

`i` is only the uploader's claim, so the server decides: HTML (including
directory indexes and the single-page-application fallback) always revalidates,
since those URLs are reused by every publish and a page pinned in browsers
would outlive later publishes with no way to purge it. Other flagged files get
a year, `immutable`. To change that, pass `cacheControl({ site, path,
immutable })`, e.g. to require hashed-looking names, or to answer
`private, no-cache` for a site only some viewers may see.

**Service workers** are off unless `serviceWorkers` (`true`, or
`(site) => boolean`) allows them. Browsers fetch a worker script with a
`Service-Worker: script` header; when the site isn't allowed workers, or the
path isn't a file in the live version, `SiteServer` answers 200 with a script
that unregisters the installed worker and reloads its pages. That is how a
worker left by an earlier publish, a removed teammate or a slug's previous
owner goes away: a failed update check leaves the old worker in control.

Create one `SiteStore` and one `SiteServer` per isolate (at module scope), not
per request, so their caches last.

## What the caller owns

- **Auth and ownership.** `handleUpload` trusts `site` and `publishId`. Route to
  it only after checking the user owns the site. Authenticate upload routes
  with a bearer token (`createHttpTransport`'s `headers`), not a cookie session,
  and don't answer them with credentialed CORS. `handleUpload` requires
  `Content-Type: application/json` on plan and commit, so a web page can't send
  any upload request without a preflight, but a cookie that reaches these
  routes is still one misconfigured CORS header away from letting any page
  re-point a user's site.
- **One publish per site at a time.** Plan, upload, commit and cleanup for one
  site must not overlap: hold a per-site lock, and hold it until the publish's
  commit has succeeded (including the client's retries). Plan expiry (1 h) and the orphan
  grace period (1 h) limit the damage if a lock holder dies, but don't replace
  the lock.
- **Calling cleanup** after each commit, still holding the lock. Recording a
  new plan also runs it, so publishes that were uploaded but never committed
  are cleared by the site's next plan. A site that stops publishing keeps its
  last abandoned upload until then; a scheduled cleanup (under the lock) clears
  those too.
- **Site keys that aren't reused.** A site's R2 data (files, plans, pointer)
  is keyed by `site`. Use a permanent internal id as the key and map public
  slugs to it, so a slug that is freed and claimed by someone else never
  reaches the old owner's data. Browsers still keep the old owner's flagged
  (non-HTML) files for up to a year under the slug's URLs. Pages revalidate,
  but a service worker the old owner (or a removed teammate) registered keeps
  answering for the origin in browsers that installed it, until its update
  check replaces it; a 404 there doesn't. See *Service workers* above. Prefer
  not handing a freed slug to someone else at all; if you do, the site Worker
  can also send `Clear-Site-Data: "storage"` on the new owner's first pages.
- **Rate limits and quotas.** Built-in limits are per publish: 10,000 files,
  95 MiB per file (under the Workers 100 MB request-body limit), 500 MiB total,
  2 MiB of file-list JSON. A site holds its live version, retained chunks and
  any plans from the last hour, so storage per site is bounded by how many
  publishes an hour the caller allows; meter PUT `Content-Length` for a byte
  quota per user. Rate-limit the site Worker per IP as well.

## Tests

`npm test` runs everything against workerd with no R2 mock. The Worker in
`test/worker.ts` runs under Wrangler's `createTestHarness()`:

- the store and serving tests drive its local R2 bucket from Node;
- `test/e2e.test.ts` publishes a folder over real HTTP with the client, then
  checks serving and the Cache API. The Worker runs without `nodejs_compat`,
  so a Node import in `src/server` stops it from starting and fails the suite.

Assertions are mostly inline snapshots, with hashes shown as `sha(<content>)`,
so a reviewer can read what the code actually produced.

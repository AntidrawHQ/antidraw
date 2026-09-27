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
shared by concurrent requests, 32 MiB of pointers at most), maps the URL to a
file, and answers ETag/304 and single-range requests itself. It never throws:
storage failures become a 503 with `retry-after`.

Pass `cache: caches.default` to read file bytes through the Workers Cache API,
keyed by hash so an entry never goes stale; a miss fills it once per isolate
after the response, through `ctx.waitUntil`. Leave it off on workers.dev,
where the Cache API keeps nothing. Content types come from the `mime` package,
as in Cloudflare's own static-asset serving.

Create one `SiteStore` and one `SiteServer` per isolate (at module scope), not
per request, so their caches last.

## What the caller owns

- **Auth and ownership.** `handleUpload` trusts `site` and `publishId`. Route to
  it only after checking the user owns the site.
- **One publish per site at a time.** Plan, upload, commit and cleanup for one
  site must not overlap: hold a per-site lock, and hold it until the publish's
  commit has succeeded (including the client's retries). Plan expiry (1 h) and the orphan
  grace period (1 h) limit the damage if a lock holder dies, but don't replace
  the lock.
- **Calling cleanup**, e.g. after each commit while still holding the lock.
- **Rate limits and quotas.** Built-in limits are per publish: 10,000 files,
  95 MiB per file (under the Workers 100 MB request-body limit), 500 MiB total.

## Tests

`npm test` runs everything against workerd with no R2 mock. The Worker in
`test/worker.ts` runs under Wrangler's `createTestHarness()`:

- the store and serving tests drive its local R2 bucket from Node;
- `test/e2e.test.ts` publishes a folder over real HTTP with the client, then
  checks serving and the Cache API. The Worker runs without `nodejs_compat`,
  so a Node import in `src/server` stops it from starting and fails the suite.

Assertions are mostly inline snapshots, with hashes shown as `sha(<content>)`,
so a reviewer can read what the code actually produced.

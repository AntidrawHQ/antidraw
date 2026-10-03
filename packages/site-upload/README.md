# @antidraw/site-upload

Publishes a static-site folder (a build's `dist`) to R2 and serves it. Modelled
on how `wrangler deploy` uploads Workers static assets: hash every file, ask
the server which hashes it lacks, upload only those, then switch the site over
to the new version in one write to the caller's own records.

```
client (Node)                         server (Worker + R2)
─────────────                         ────────────────────
buildManifest(dir)   ── POST plan ──▶ store.plan             → { missing }
upload missing       ── PUT files/h ▶ store.putFile          R2 checks sha256 on write
                     ── POST commit ▶ store.requireComplete,
                                      then the caller's commit  one database write
                                      store.cleanup          drop unneeded files (by hand)
                                      SiteServer             serve GET / HEAD / Range
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
<prefix>/<site>/m/<publishId>.json  one publish's manifest, written when it plans
```

Nothing here changes once written. A version of the site is a manifest;
which one is live is the caller's to record, usually a database row with the
live and previous publish ids.

**Committing.** `handleUpload`'s commit checks the plan's files are all stored
(`store.requireComplete`), then calls the caller's `commit`, which records the
publish as live. Record it only if nothing went live since the publish started
(say, a commit counter compared and bumped in one update), and throw
`SUPERSEDED` otherwise: then two overlapping publishes can't both go live on
the same version, and an old commit retried late can't roll the site back. A
retry of the publish already live answers `alreadyCommitted: true`. Rolling
back is recording an older publish id.

**What stays servable.** The live version, plus the previous version's
immutable files (`i: true`, i.e. hashed build output) that the live version
dropped, so a page opened before a publish can still load its chunks. Nothing
older, and never a page: HTML, SVG and other XML documents are not served from
the previous version or cached as immutable, whatever the uploader marks.

## Serving and caching

`SiteServer` asks the caller's `current(site)` which publishes are live (kept
in memory for 5 s, one call shared by concurrent requests, asked again on a
miss at most once a second), reads their manifests (never changing, so kept
until evicted, 32 MiB at most), maps the URL to a file (`/a` is `a`, else
`a.html`, else a redirect to `/a/` for `a/index.html`, else the previous
version's hashed chunk), and answers ETag/304 and single-range requests
itself. It reads the previous manifest only for a path the live one doesn't
have. It never throws: failures become a 503 with `retry-after`.

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
- **Which version is live.** The `commit` passed to `handleUpload`, and the
  `current` passed to `SiteServer` (see *Committing* above).
- **Deleting old files, if ever.** The store never deletes while publishing,
  so a site keeps every file and manifest it was ever sent.
  `cleanup(site, { keep })` deletes the manifests not in `keep` (pass at least
  the live and previous publishes) and the files only they needed, sparing
  anything under an hour old. It must not overlap any other call for the site
  (a plan made during it can be told a file is stored that it then deletes):
  run it by hand when nothing is publishing.
- **Site keys that aren't reused.** A site's R2 data (files and manifests)
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
  2 MiB of file-list JSON. Until a cleanup, a site holds every file and
  manifest it was ever sent, so storage grows with every change published; meter PUT
  `Content-Length` for a byte quota per user. Rate-limit the site Worker per IP
  as well.

## Tests

`npm test` runs everything against workerd with no R2 mock. The Worker in
`test/worker.ts` runs under Wrangler's `createTestHarness()`:

- the store and serving tests drive its local R2 bucket from Node;
- `test/e2e.test.ts` publishes a folder over real HTTP with the client, then
  checks serving and the Cache API. The Worker runs without `nodejs_compat`,
  so a Node import in `src/server` stops it from starting and fails the suite.

Assertions are mostly inline snapshots, with hashes shown as `sha(<content>)`,
so a reviewer can read what the code actually produced.

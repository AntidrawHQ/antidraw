# @antidraw/server

The antidraw **cloud API** — a [Hono](https://hono.dev) app running on a
[Cloudflare Worker](https://developers.cloudflare.com/workers/), backed by
[D1](https://developers.cloudflare.com/d1/) (SQLite) via Drizzle.

This is the real, network-exposed backend. It is **not** the in-Electron API in
`@antidraw/shell` (that one runs inside the Electron main process over the
private `antidraw://app/api/*` scheme and is not network-exposed). The trust
boundary for cloud operations — "can this user publish/sync" — lives here,
where Cloudflare credentials are held and never reach any client.

## Conventions

Mirrors `@antidraw/shell`: thin Hono controllers → services returning
[`neverthrow`](https://github.com/supermacro/neverthrow) `Result`s with a
`{ status, code, message }` error (`src/lib/errors.ts`). `respond()`
(`src/lib/respond.ts`) serializes a `Result` to a JSON response. Validate input
with `@hono/zod-validator` + `zod`. Imports are **relative** (wrangler's esbuild
does not resolve tsconfig path aliases).

Every app and controller is typed `new Hono<AppEnv>()` (`src/lib/env.ts`).
Hono does not check that a mounted sub-app's env matches its parent, so a bare
`new Hono()` compiles and then leaves `ctx.env` typed as `unknown`.

Failures answer with one shape on every path — including a route miss and an
uncaught throw, which `app.notFound` / `app.onError` route through the same
envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Not found" } }
```

```
src/
  index.ts               # createApp(): mounts controllers under /api + fallbacks
  controllers/           # thin Hono sub-apps (one per feature)
  services/              # business logic, returns Result<_, ApiError>
  models/                # drizzle tables, one file per feature
    auth.model.ts        # better-auth's tables — generated, never hand-edit
  db/
    index.ts             # getDb(env) -> request-scoped drizzle client
    schema.ts            # re-exports every models/*.model.ts
    migrations/          # generated SQL, applied via wrangler
  lib/                   # env (bindings), errors, respond helper, auth wiring
```

Worker binding types are hand-maintained in `src/lib/env.ts`, the single
source of truth, so there is no `wrangler types` step to keep in sync.

## Develop

```sh
cd packages/server
npm run dev          # wrangler dev — local Worker + D1 on http://localhost:8799
npm test             # vitest
npm run typecheck
```

`GET /api/health` → `{ "status": "ok", "service": "antidraw-server" }`.

For local secrets, copy `.dev.vars.example` to `.dev.vars` (gitignored).

### Schema changes

```sh
npm run db:generate           # drizzle-kit -> src/db/migrations/*.sql
npm run db:migrate:local      # apply to local D1 (for `wrangler dev`)
```

Add or edit a `src/models/*.model.ts` (re-exported from `src/db/schema.ts`),
generate, then apply. Migrations are applied by `wrangler d1 migrations apply`,
not by drizzle-kit.

better-auth owns `src/models/auth.model.ts`. After changing the auth config's
plugins, regenerate it, then generate a migration as above:

```sh
npm run auth:generate         # better-auth CLI -> src/models/auth.model.ts
```

## Auth

[better-auth](https://better-auth.com) (`src/lib/auth.ts`) serves everything
under `/api/auth/*`: Google sign-in over the Drizzle/D1 adapter, sessions, and
the desktop sign-in flow. Clients authenticate with
`Authorization: Bearer <token>` (better-auth's `bearer` plugin), where the
token is the signed one `/api/auth/desktop/token` returns; raw session tokens
are rejected. The Worker refuses to start if `BETTER_AUTH_SECRET` (32+ chars),
`BETTER_AUTH_URL` or the Google credentials are missing.

- **Gate:** `requireSession` (`src/lib/require-session.ts`) is the only way a
  route reads the signed-in user: `ctx.get("user")` / `ctx.get("session")`, or
  401 in the standard envelope. `GET /api/me` is the simplest example.
- **Identity:** `user.id` is ours; Google's subject lives in
  `account.account_id`. App tables reference `user.id`, so the identity
  provider stays swappable.

### Desktop sign-in

The Electron app signs in through the system browser with a loopback redirect
and PKCE ([RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252) +
[RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636), S256 only). The app
never talks to Google and never holds a Google secret. The endpoints come from
a small better-auth plugin (`src/lib/desktop-auth.plugin.ts`); the protocol
lives in `src/services/auth.service.ts`.

1. The app makes a PKCE verifier + `state`, listens on
   `http://127.0.0.1:<port>/callback`, and opens
   `GET /api/auth/desktop/start?redirect_uri&code_challenge&code_challenge_method=S256&state`
   in the browser. The Worker records the flow and redirects to Google.
2. After Google, better-auth lands on `/api/auth/desktop/callback`. The Worker
   swaps the browser's session for a single-use code (the browser is left
   signed out, whatever the outcome; a session older than the flow doesn't
   count) and redirects to the loopback URL with `?code&state` — or
   `?error&state` if sign-in failed.
3. The app checks `state` and calls `POST /api/auth/desktop/token` with
   `{ code, code_verifier }`, getting `{ token, expiresAt, user }` — a session
   of its own, independent of any browser.

Flow state lives in better-auth's `verification` table and is consumed
atomically, so each hop is single-use. To try it end to end, run `npm run dev`
here (with real Google creds in `.dev.vars`) and the shell alongside it, then
click Publish in the app while signed out.

The client side lives in `@antidraw/shell`: `src/main/services/account.service.ts`
runs the loopback server and PKCE pair in the main process, keeps the token
with `safeStorage` (OS keychain), and makes Worker calls from main with
`Authorization: Bearer`. The renderer never sees the token. The shell points at
`http://localhost:8799` unless `ANTIDRAW_SERVER_URL` is set.

### Google OAuth client

In Google Cloud console → APIs & Services → Credentials, create an OAuth client
of type **Web application** with these authorized redirect URIs:

- `http://localhost:8799/api/auth/callback/google` (local)
- `https://<worker-host>/api/auth/callback/google` (production)

Put its ID and secret in `.dev.vars` locally (see `.dev.vars.example`). While
the consent screen is in "Testing", only its listed test users can sign in.

## Deploy (needs a Cloudflare login)

```sh
npx wrangler login

# 1. Create the D1 database, then paste the printed database_id into
#    wrangler.jsonc (d1_databases[0].database_id).
npx wrangler d1 create antidraw

# 2. Apply migrations.
npm run db:migrate            # remote D1

# 3. Set production secrets.
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Required too: an https URL here is what makes auth cookies Secure. Either a
# secret or a plain var in wrangler.jsonc ("vars": { "BETTER_AUTH_URL": ... }).
npx wrangler secret put BETTER_AUTH_URL

# 4. Ship it.
npm run deploy
```

## Publish

The Publish button (in `@antidraw/shell`, from the main process) publishes a
workspace as a read-only canvas site at `https://<slug>.antidraw.app`, and
stores a snapshot of its source that others can remix. All routes are behind
`requireSession` except `/api/storage/:token`.

| Route | What |
|---|---|
| `POST /api/publish/sessions` | begin: validate the plan, find or create the workspace's site, sign upload URLs for what the server lacks |
| `POST /api/publish/sessions/:id/complete` | verify every upload, commit the version, write the site's pointer (the switch-over) |
| `POST /api/publish/sessions/:id/abort` | best effort, idempotent |
| `GET /api/publish/sessions/:id` | settle a complete whose outcome the app could not see |
| `GET /api/publish/sites?clientWorkspaceId=` / `PATCH /api/publish/sites/:siteId` | site status; `{ allowRemix }` |
| `POST /api/remix` | 10-minute download URLs for a site's head snapshot |
| `PUT` / `GET /api/storage/:token` | local dev only (below) |

Code: `controllers/{publish,remix,storage}.controller.ts` → `services/publish.service.ts`,
`remix.service.ts`, `gc.service.ts` → `services/publish.store.ts` (all the D1
SQL), `services/site-pointer.ts` (the pointer) and `lib/storage.ts` (R2 and
URL signing). Wire schemas are in
`lib/publish.schemas.ts`, limits in `lib/publish-limits.ts`.

**Storage.** Two R2 buckets:

- `antidraw-sites` (binding `SITES`, public through `packages/publish-worker`):
  `c/<userId>/<sha256>`, each distinct site file content once per account
  (the entry pages `preview.html`, `canvas.json` and `index.html` included),
  immutable; and `m/<slug>.json`, the site's pointer: the manifest of every
  path the site serves (`{ "v": 1, "version", "u": <owner id>, "files": {
  "<path>": { "h": <sha256>, "s": <size>, "t": <content type>, "i": 1 } } }`).
  `"i": 1` marks an immutable file: one the build named by its content (the
  plan's `immutable`) at a hashed `assets/*-<hash>.*` or `_antidraw/*` path,
  which the publish Worker caches for a year; a public file whose name only
  looks hashed is not one. The pointer lists the head version's files plus
  "grace" entries, the immutable files of the four previous versions that the
  head does not define, so a tab open on an older version can still lazy-load
  its chunks (capped at ~2 MB, oldest dropped first). Uploads never
  change what visitors see: complete commits the version and then writes the
  pointer in one conditional put (never replacing a newer version's), so a
  site switches over atomically and a failed or cancelled publish leaves it
  as it was. If that write fails the version is committed but not live yet;
  complete answers 500 `STORAGE_FAILED`, and its retry (or GC's hourly
  re-sync) writes it.
- `antidraw-sources` (binding `SOURCES`, private): `u/<userId>/source/<sha256>.tar.gz`
  and `u/<userId>/blob/<sha256>`, content-addressed per account and
  deduplicated. Each account has a 1 GiB quota over every source and blob GC
  has not removed, committed or not. Site contents are outside it.

Every object (`stored_object`, kinds `source`, `blob` and `site`) is kept
while a retained version lists it (`site_version`, `version_large_file`,
`version_site_file`) or a session that can still upload holds it. Begin also
bounds what a signed-in client can park before it commits: at most 10
uncommitted sessions whose upload URLs still work (429 `RATE_LIMITED`,
`details.reason: "open-sessions"`), and at most 1 GiB of site contents no
commit has verified across them (413 `QUOTA_EXCEEDED`, `details.reason:
"pending-site"`). Site contents are append-only, so begin also bounds what an
account keeps: at most 4 GiB of site contents GC has not removed, committed
or not (`details.reason: "site-storage"`; a publish that adds no new content
passes), and at most 64 MiB of estimated D1 footprint in retained
`version_site_file` rows (`details.reason: "site-files"`). A version keeps
all its site-file rows only while the site's pointer may still be at it; once
the pointer moves past it, only the rows a grace entry can use (its
immutable files) are kept.

Clients PUT bytes straight to R2 with presigned S3 URLs (aws4fetch), signed
over `content-length`, the sha256 checksum and the metadata; complete then
HEAD-checks size and sha256 of every object no commit has verified and no
earlier attempt of the session found (a verified row always has its bytes:
only GC deletes object keys, after marking their rows `deleting`), stopping
once 50 are missing. Begin HEADs only objects with an unverified row: one
without a row is not in R2. Every upload carries its sha256.

**GC** runs hourly from the cron trigger (`src/scheduled.ts`): expire lapsed
sessions, drop versions beyond the newest 5 (`keep` ones excepted), re-sync
the pointers of sites whose pointer is behind their head version, delete
account objects (sources, blobs and site contents) nothing references or
holds (never-committed ones as soon as no session's upload URLs can still
reach them, committed ones after 24 h; claimed in turns across accounts),
retire sessions whose hold ended (plan stubbed, held objects dropped) and
forget old ones, and free the slugs of sites that never completed (their
pointer first). Each step is bounded (`GcLimits` in
`src/services/gc.service.ts`) and independent; a run that stops with work
left says so in `report.backlog` and logs a warning, and the next run
continues. GC
treats a session as expired, or its hold as ended, only 5 minutes after the
fact by its own clock (`GC_CLOCK_SKEW_MARGIN_MS`), so a complete whose
Worker's clock lags GC's still finds what its commit checks.

### Local end to end

Everything runs against local wrangler state; nothing touches Cloudflare.

```sh
STATE=$PWD/../../.wrangler/shared
# .dev.vars (from .dev.vars.example): leave R2_* empty and keep
# STORAGE_MODE="worker" — together they enable /api/storage/:token, which
# stands in for presigned URLs and writes to the local R2 bindings with the
# sha256 check. SITE_URL_TEMPLATE="http://{slug}.localhost:8787".
npm run db:migrate:local -- --persist-to "$STATE"
npm run dev -- --persist-to "$STATE" --test-scheduled            # :8799
npm run dev -w @antidraw/publish-worker -- --persist-to "$STATE"   # :8787, same sites bucket
```

Publish from the app, then open `http://<slug>.localhost:8787/`. Run GC with
`curl "http://localhost:8799/cdn-cgi/handler/scheduled?cron=17+*+*+*+*"`
(age rows first with `wrangler d1 execute antidraw --local --persist-to "$STATE"`
to see it delete something).

Tests (`npm test`) cover the SQL against node:sqlite (`src/test/d1-sqlite.ts`,
which enforces D1's 100-parameter and 100 KB statement limits; Node >= 22.5),
and the services against in-memory stores. R2's checksum enforcement on a
presigned PUT, the rate limiters and cron dispatch are not unit-testable.

### Deploying publish

- **Workers Paid is required.** Free allows 50 subrequests per request (R2 and
  D1 binding calls count) and 50 D1 queries per invocation; complete HEADs
  every object of a first publish that no commit has verified (up to ~6 000
  R2 calls: source, blobs and site contents; begin HEADs only objects an
  earlier, uncommitted session left) and each runs a few dozen D1 statements.
  Paid allows 10 000 and 1 000.
- Create the buckets (`wrangler r2 bucket create antidraw-sites` and
  `antidraw-sources`), and set `R2_ACCOUNT_ID`, `R2_S3_ACCESS_KEY_ID` and
  `R2_S3_SECRET_ACCESS_KEY` (an R2 API token with Object Read & Write on both
  buckets) with `wrangler secret put`. Without all three, publish answers
  500 `STORAGE_MISCONFIGURED`; `STORAGE_MODE` is never set in production.
- **`BETTER_AUTH_URL` must never be a host under the site domain** (the
  hostname of `SITE_URL_TEMPLATE` without `{slug}.`). Published sites run
  arbitrary JS there and can set cookies on the parent domain; the server
  refuses to publish (500 `CONFIG_INVALID`) when the two overlap.
- **Before wildcard DNS for `*.antidraw.app` goes live**, get `antidraw.app` on
  the Public Suffix List. Until then sibling sites are same-site: one site can
  set cookies for all others, and one phishing slug can get the whole domain
  flagged. No first-party service may live under that domain.
- Open check before production: confirm once against a staging bucket that R2
  rejects a presigned PUT whose body does not match `x-amz-checksum-sha256`
  (see the TODO in `src/lib/storage.ts`).

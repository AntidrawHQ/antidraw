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

Worker binding types are hand-maintained in `src/lib/env.ts` — with five
bindings that is the single source of truth, so there is no `wrangler types`
step to keep in sync.

## Develop

```sh
cd packages/server
npm run dev          # wrangler dev — local Worker + D1 on http://localhost:8799
npm test             # vitest
npm run typecheck
```

Tests that need storage run the real Worker in workerd with local D1 and R2
(`src/test/harness.ts`, Wrangler's test harness); the rest call the Hono app
directly.

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
- `https://api.antidraw.com/api/auth/callback/google` (production)

Put its ID and secret in `.dev.vars` locally (see `.dev.vars.example`). While
the consent screen is in "Testing", only its listed test users can sign in.

## Publishing

Signed-in users publish a workspace's built components and its `canvas.json`,
served at `<slug>.antidraw.app` by a separate Worker (`@antidraw/site-worker`).
People visit the site's share page, `antidraw.com/s/<slug>` (the `url`
`POST /api/sites` returns): the canvas, which reads `canvas.json` from the site
and shows each component in an iframe of its `/preview`. The site's own `/`
redirects there. The routes are in `src/controllers/site.controller.ts`, and
the upload protocol, storage and serving are `@antidraw/site-upload`'s. R2
holds what never changes, keyed by the site's permanent id, never its slug:
files by hash, and each publish's manifest. D1 (`src/models/site.model.ts`)
holds what does: each site's owner, slug, and which publish is live, plus a
row per publish. The routes take only a bearer token, never a cookie.

A commit is one D1 update: the site's live publish switches to this one only
if the site's `seq` is still the one the publish started from. So publishes may
overlap; the first to commit goes live, and the others get `SUPERSEDED` and
start again. A retried commit of the live publish gets the same answer, and an
old one retried late can't roll the site back. Rolling back is the same switch
to an older publish id.

Nothing is deleted while publishing, so a site keeps every file and manifest
it was ever sent. To reclaim space, run `SiteStore.cleanup(siteId, { keep })`
by hand while nothing publishes to that site, keeping at least its live and
previous publishes.

## Deploy (needs a Cloudflare login)

Two Workers: this API, and `@antidraw/site-worker`, which serves published
sites at `<slug>.antidraw.app`. They share the D1 database and R2 bucket.

```sh
npx wrangler login

# 1. Create the D1 database, then paste the printed database_id into
#    wrangler.jsonc (d1_databases[0].database_id) here and in
#    packages/site-worker/wrangler.jsonc (the top-level one).
npx wrangler d1 create antidraw

# 2. Apply migrations, and create the bucket for published sites.
npm run db:migrate            # remote D1
npx wrangler r2 bucket create antidraw-sites

# 3. Set production secrets.
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Required too: https://api.antidraw.com. An https URL here is what makes auth
# cookies Secure. Either a secret or a plain var in wrangler.jsonc
# ("vars": { "BETTER_AUTH_URL": ... }).
npx wrangler secret put BETTER_AUTH_URL

# 4. Ship the API (from the repo root).
npm run deploy:server

# 5. Serve it at api.antidraw.com: in the dashboard, Workers & Pages →
#    antidraw-server → Settings → Domains & Routes → add the custom domain.
#    (Its own subdomain, not antidraw.com/api: the landing page and the share
#    pages keep antidraw.com, and the API's auth cookies stay off them.)

# 6. Serve sites. In the antidraw.app zone, add a proxied DNS record
#    `* AAAA 100::` so every subdomain reaches Cloudflare. The Worker's
#    `*.antidraw.app/*` route must be free: if another Worker holds it, remove
#    that route first (the deploy refuses otherwise). Then:
npm run deploy:sites
```

## Next step

Publishing: a Worker endpoint behind `requireSession` that the shell's Publish
button calls through main.

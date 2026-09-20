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
  db/
    index.ts             # getDb(env) -> request-scoped drizzle client
    schema.ts            # drizzle schema (better-auth tables land here next)
    migrations/          # generated SQL, applied via wrangler
  lib/                   # env (bindings), errors, respond helper
```

Worker binding types are hand-maintained in `src/lib/env.ts` — with five
bindings that is the single source of truth, so there is no `wrangler types`
step to keep in sync.

## Develop

```sh
cd packages/server
npm run dev          # wrangler dev — local Worker + D1 on http://localhost:8787
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

Edit `src/db/schema.ts`, generate, then apply. Migrations are applied by
`wrangler d1 migrations apply`, not by drizzle-kit — D1 has no direct
connection string.

## Deploy (needs a Cloudflare login)

```sh
npx wrangler login

# 1. Create the D1 database, then paste the printed database_id into
#    wrangler.jsonc (d1_databases[0].database_id).
npx wrangler d1 create antidraw

# 2. Apply migrations.
npm run db:migrate            # remote D1

# 3. Set production secrets (when better-auth is wired up).
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# BETTER_AUTH_URL can be a plain var in wrangler.jsonc once the prod URL is known.

# 4. Ship it.
npm run deploy
```

## Next step

Wire [better-auth](https://better-auth.com) at `/api/auth/*` with the Google
social provider over the Drizzle/D1 adapter (`provider: "sqlite"`), then the
Electron sign-in flow (system-browser sign-in + OS-keychain token custody).

Two constraints for that step, so the identity provider stays swappable: app
tables should reference an app-owned user id rather than the provider's (keep
the provider's id in its own column), and session handling should sit behind a
single middleware that feature code never bypasses.

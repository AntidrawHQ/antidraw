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

```
src/
  index.ts               # Worker entrypoint; mounts controllers under /api
  controllers/           # thin Hono sub-apps (one per feature)
  services/              # business logic, returns Result<_, ApiError>
  db/
    index.ts             # getDb(env) -> request-scoped drizzle client
    schema.ts            # drizzle schema (better-auth tables land here next)
    migrations/          # generated SQL, applied via wrangler
  lib/                   # env (bindings), errors, respond helper
```

## Develop

```sh
cd packages/server
npm run dev          # wrangler dev — local Worker + D1 on http://localhost:8787
npm test             # vitest
npm run typecheck
```

`GET /api/health` → `{ "status": "ok", "service": "antidraw-server" }`.

For local secrets, copy `.dev.vars.example` to `.dev.vars` (gitignored).

## Deploy (needs a Cloudflare login)

```sh
npx wrangler login

# 1. Create the D1 database, then paste the printed database_id into
#    wrangler.jsonc (d1_databases[0].database_id).
npx wrangler d1 create antidraw

# 2. Apply migrations (once there are any).
npm run db:migrate            # remote D1
npm run db:migrate:local      # local D1 (for `wrangler dev`)

# 3. Set production secrets (when better-auth is wired up).
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# BETTER_AUTH_URL can be a plain var in wrangler.jsonc once the prod URL is known.

# 4. Ship it.
npm run deploy

# Optional: regenerate Worker binding types after editing wrangler.jsonc.
npm run cf-typegen
```

## Next step

Wire [better-auth](https://better-auth.com) at `/api/auth/*` with the Google
social provider over the Drizzle/D1 adapter (`provider: "sqlite"`), then the
Electron sign-in flow (system-browser sign-in + OS-keychain token custody) per
`worktree-task.md`.

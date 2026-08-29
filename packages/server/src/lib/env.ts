// Worker bindings + secrets. D1Database comes from @cloudflare/workers-types.
//
// In Hono, bindings are reached via `ctx.env`. Configure the typed app with
// `new Hono<{ Bindings: Bindings }>()` so `ctx.env.DB` etc. are typed.
//
// Secrets (everything except DB) are set with `wrangler secret put <NAME>` for
// production and via `.dev.vars` locally (see .dev.vars.example). They are
// unused until better-auth is wired in the next step.
export type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

// Worker bindings + secrets. D1Database comes from @cloudflare/workers-types.
//
// Secrets (everything except DB) are set with `wrangler secret put <NAME>` for
// production and via `.dev.vars` locally (see .dev.vars.example).
export type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

// The Hono env for every app and controller in this package. Hono does not
// check that a sub-app's env matches the parent it is mounted on, so a
// controller declared as a bare `new Hono()` compiles fine and then has
// `ctx.env` typed as `unknown`. Always `new Hono<AppEnv>()`.
export type AppEnv = {
  Bindings: Bindings;
};

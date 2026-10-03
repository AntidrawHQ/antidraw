// Worker bindings + secrets. D1Database comes from @cloudflare/workers-types.
//
// Secrets (everything but the bindings and SHARE_URL_PATTERN, a plain var in
// wrangler.jsonc) are set with `wrangler secret put <NAME>` for production
// and via `.dev.vars` locally (see .dev.vars.example).
export type Bindings = {
  DB: D1Database;
  // Published sites' files (@antidraw/site-upload's layout, under sites/).
  SITES: R2Bucket;
  // A published site's share page, with * for its slug: https://antidraw.com/s/*
  SHARE_URL_PATTERN: string;
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

// `import { env } from "cloudflare:workers"` types its env as Cloudflare.Env.
// Point that at Bindings so module-scope code (the auth instance in
// lib/auth.ts) sees the same typed bindings as `ctx.env`.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}

// Worker bindings, vars + secrets. D1Database, R2Bucket and RateLimit come
// from @cloudflare/workers-types.
//
// Secrets are set with `wrangler secret put <NAME>` for production and via
// `.dev.vars` locally (see .dev.vars.example). Plain vars live in
// wrangler.jsonc, which `.dev.vars` overrides.
export type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // Publish + remix (see README → Publish).
  SITES: R2Bucket; // antidraw-sites: public, served by packages/publish-worker
  SOURCES: R2Bucket; // antidraw-sources: private snapshots, per account
  PUBLISH_RATE_LIMITER: RateLimit;
  REMIX_RATE_LIMITER: RateLimit;
  SITE_URL_TEMPLATE: string; // "https://{slug}.antidraw.app"
  // Must match r2_buckets; used in presigned S3 URLs.
  SITES_BUCKET_NAME: string;
  SOURCES_BUCKET_NAME: string;
  // An R2 API token (Object Read & Write on both buckets). All three, or none
  // with STORAGE_MODE="worker" for local dev.
  R2_ACCOUNT_ID?: string;
  R2_S3_ACCESS_KEY_ID?: string;
  R2_S3_SECRET_ACCESS_KEY?: string;
  STORAGE_MODE?: string; // "worker" only in .dev.vars, never in wrangler.jsonc
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

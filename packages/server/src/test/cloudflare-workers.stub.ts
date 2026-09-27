// Stand-in for the `cloudflare:workers` built-in under vitest, which runs in
// plain Node (see vitest.config.ts). Only `env` is imported by app code. D1
// and R2 are throwing stubs: building the auth instance doesn't touch them,
// and a test that reaches one should fail loudly rather than pass on a fake
// (publish tests pass fakes explicitly, through createApp({ publishDeps })).
// No S3 credentials and no STORAGE_MODE: storage is "misconfigured" unless a
// test says otherwise.
import type { Bindings } from "../lib/env";

const unavailable = <T extends object>(name: string) =>
  new Proxy({} as T, {
    get() {
      throw new Error(`${name} is not available in unit tests`);
    },
  });

const allowAll: RateLimit = { limit: async () => ({ success: true }) };

export const env: Bindings = {
  DB: unavailable<D1Database>("D1"),
  BETTER_AUTH_SECRET: "test-secret-with-enough-entropy-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:8799",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  SITES: unavailable<R2Bucket>("R2 (SITES)"),
  SOURCES: unavailable<R2Bucket>("R2 (SOURCES)"),
  PUBLISH_RATE_LIMITER: allowAll,
  REMIX_RATE_LIMITER: allowAll,
  COMPLETE_RATE_LIMITER: allowAll,
  SITE_URL_TEMPLATE: "http://{slug}.localhost:8787",
  SITES_BUCKET_NAME: "antidraw-sites",
  SOURCES_BUCKET_NAME: "antidraw-sources",
};

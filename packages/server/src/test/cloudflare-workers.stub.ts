// Stand-in for the `cloudflare:workers` built-in under vitest, which runs in
// plain Node (see vitest.config.ts). Only `env` is imported by app code. D1 and
// R2 are throwing stubs: building the auth instance doesn't touch them, and a
// test that reaches storage should fail loudly rather than pass on a fake.
// Tests that need storage run the real Worker (see test/harness.ts).
import type { Bindings } from "../lib/env";

const unavailable = <T extends object>(name: string) =>
  new Proxy({} as T, {
    get() {
      throw new Error(`${name} is not available in unit tests`);
    },
  });

export const env: Bindings = {
  DB: unavailable<D1Database>("D1"),
  SITES: unavailable<R2Bucket>("R2"),
  SITE_URL_PATTERN: "http://*.localhost:8787",
  BETTER_AUTH_SECRET: "test-secret-with-enough-entropy-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:8799",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

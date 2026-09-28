// Stand-in for the `cloudflare:workers` built-in under vitest, which runs in
// plain Node (see vitest.config.ts). Only `env` is imported by app code. D1 is
// a throwing stub: building the auth instance doesn't touch it, and a test
// that reaches the database should fail loudly rather than pass on a fake.
import type { Bindings } from "../lib/env";

const unavailableD1 = new Proxy({} as D1Database, {
  get() {
    throw new Error("D1 is not available in unit tests");
  },
});

export const env: Bindings = {
  DB: unavailableD1,
  BETTER_AUTH_SECRET: "test-secret-with-enough-entropy-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:8799",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

import { fileURLToPath } from "node:url";
import { generateRandomString, makeSignature } from "better-auth/crypto";
import { createTestHarness } from "wrangler";
import type { Bindings } from "../lib/env";

// Runs this package's real Worker (wrangler.jsonc) in workerd with local D1 and
// R2, through Wrangler's integration-test harness, for tests that need storage.
// Nothing is stubbed: requests go through better-auth, drizzle and R2.

const SECRET = "test-secret-with-enough-entropy-0123456789abcdef";

export type TestServer = {
  url: URL;
  /** The Worker's bindings, driven from Node: seed and inspect D1 and R2. */
  env: Bindings;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** A new user with a session; returns its Authorization header value. */
  signIn(name?: string): Promise<{ userId: string; authorization: string }>;
  close(): Promise<void>;
};

export async function startServer(): Promise<TestServer> {
  const harness = createTestHarness({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    workers: [
      {
        configPath: "./wrangler.jsonc",
        secrets: {
          BETTER_AUTH_SECRET: SECRET,
          BETTER_AUTH_URL: "http://localhost:8799",
          GOOGLE_CLIENT_ID: "test-google-client-id",
          GOOGLE_CLIENT_SECRET: "test-google-client-secret",
        },
        vars: { SHARE_URL_PATTERN: "https://share.test/s/*" },
      },
    ],
  });
  const { url } = await harness.listen();
  const worker = harness.getWorker<Bindings>();
  await worker.applyD1Migrations("DB");
  const env = await worker.getEnv();

  let users = 0;
  return {
    url,
    env,
    fetch: (path, init) => fetch(new URL(path, url), init),
    async signIn(name = `user${++users}`) {
      // What better-auth writes when Google sign-in succeeds, and the signed
      // token /api/auth/desktop/token hands the app.
      const userId = generateRandomString(24, "a-z", "0-9");
      const token = generateRandomString(32, "a-z", "A-Z", "0-9");
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
        ).bind(userId, name, `${userId}@example.com`, now, now),
        env.DB.prepare(
          "INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(`s-${userId}`, token, userId, now + 24 * 60 * 60 * 1000, now, now),
      ]);
      const signature = await makeSignature(token, SECRET);
      return { userId, authorization: `Bearer ${token}.${signature}` };
    },
    close: () => harness.close(),
  };
}

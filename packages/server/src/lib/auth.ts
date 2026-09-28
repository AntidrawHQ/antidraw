import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { bearer } from "better-auth/plugins";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { desktopAuth } from "./desktop-auth.plugin";

// Fail at startup rather than run misconfigured. Without a secret, better-auth
// falls back to a public default and only refuses it when NODE_ENV is
// "production", which Workers don't set. Without a base URL, cookies go out
// without Secure. (Under the better-auth CLI, `env` is an inert stub whose
// values are truthy non-strings, so these pass.)
for (const name of [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const) {
  if (!env[name]) throw new Error(`${name} is not set (see .dev.vars.example)`);
}
if (typeof env.BETTER_AUTH_SECRET === "string" && env.BETTER_AUTH_SECRET.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
}
// better-auth signs with BETTER_AUTH_SECRETS (its key-rotation list) over the
// secret passed below whenever that is set, reading it from process.env, and
// only warns about a short key. Refuse it until rotation is set up here.
const rotation: unknown = (env as unknown as Record<string, unknown>).BETTER_AUTH_SECRETS;
if (typeof rotation === "string" && rotation !== "") {
  throw new Error("BETTER_AUTH_SECRETS is not supported; set BETTER_AUTH_SECRET only");
}

// One better-auth instance per isolate, built at module scope from the
// `cloudflare:workers` env import rather than per request from `ctx.env`:
// betterAuth() runs its full init eagerly, so a per-request build would redo it
// on every call. Module scope is safe here because init does no I/O with the
// drizzle adapter (its schema check is local), and it is also what lets the
// better-auth CLI load this file to generate the schema — the CLI stubs
// `cloudflare:workers` and needs an exported instance, not a factory.
export const auth = betterAuth({
  // Explicit rather than read from process.env, so the values checked above
  // are the ones used.
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(env), {
    provider: "sqlite",
    schema,
    // D1 rejects BEGIN/COMMIT, which is how drizzle runs a transaction.
    transaction: false,
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  },
  // Off: nothing here is guessable (no passwords or OTPs — Google sign-in,
  // single-use 43-char desktop codes, 256-bit session tokens), and the
  // database-backed limiter would add a D1 read + write to every auth request.
  // Abuse control, when needed, belongs at Cloudflare's edge (rate limiting
  // rules), before the Worker runs. Explicit so it doesn't hinge on how
  // better-auth detects production.
  rateLimit: {
    enabled: false,
  },
  advanced: {
    ipAddress: {
      // The client IP recorded on sessions, as Cloudflare saw it —
      // x-forwarded-for is client-settable.
      ipAddressHeaders: ["cf-connecting-ip"],
    },
  },
  plugins: [
    // Lets `Authorization: Bearer <token>` authenticate a request — the
    // desktop app holds a token, not a cookie jar. Signed tokens only (what
    // /desktop/token issues): better-auth hands out raw session tokens, e.g.
    // every session's from /list-sessions, and those must not work as
    // credentials.
    bearer({ requireSignature: true }),
    desktopAuth(),
  ],
});

export type Auth = typeof auth;

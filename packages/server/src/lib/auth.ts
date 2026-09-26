import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { bearer } from "better-auth/plugins";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { desktopAuth } from "./desktop-auth.plugin";

// One better-auth instance per isolate, built at module scope from the
// `cloudflare:workers` env import rather than per request from `ctx.env`:
// betterAuth() runs its full init eagerly, so a per-request build would redo it
// on every call. Module scope is safe here because init does no I/O with the
// drizzle adapter (its schema check is local), and it is also what lets the
// better-auth CLI load this file to generate the schema — the CLI stubs
// `cloudflare:workers` and needs an exported instance, not a factory.
export const auth = betterAuth({
  // Explicit rather than read from process.env, which is only populated on
  // Workers under some compat settings.
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
    // Lets `Authorization: Bearer <session token>` authenticate a request —
    // the desktop app holds a token, not a cookie jar.
    bearer(),
    desktopAuth(),
  ],
});

export type Auth = typeof auth;

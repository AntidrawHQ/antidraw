import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { bearer } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { getDb } from "../db";
import * as schema from "../db/schema";
import type { Bindings } from "./env";

// On Workers, secrets and the D1 binding only exist per-request on `ctx.env`,
// so the auth instance is built per-request from a handler — never at module
// top level. Call `getAuth(ctx.env)` inside a route.
//
// Sessions are issued as bearer tokens (the desktop app has no cookie jar): the
// bearer plugin lets `Authorization: Bearer <session.token>` authenticate a
// request, and oneTimeToken is the short-lived, single-use handoff used by the
// loopback sign-in flow (see desktop-auth.controller.ts).
export const getAuth = (env: Bindings) =>
  betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env), { provider: "sqlite", schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      bearer(),
      // expiresIn is in minutes (1 = the minimum); hashed at rest. The token
      // only has to survive a single browser->loopback->exchange round trip.
      oneTimeToken({ expiresIn: 1, storeToken: "hashed" }),
    ],
  });

export type Auth = ReturnType<typeof getAuth>;

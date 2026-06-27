import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../lib/env";
import { getAuth } from "../lib/auth";
import { getDb } from "../db";
import {
  consumeAuthFlow,
  createAuthFlow,
  isLoopbackRedirectUri,
  peekAuthFlow,
  sha256Base64Url,
} from "../services/desktop-auth.service";

// Loopback (127.0.0.1) sign-in for the Electron app, PKCE-bound so an
// intercepted callback is useless. Flow (see also the desktop client):
//   1. GET  /start    desktop opens this in the system browser; we stash the
//                     PKCE challenge and redirect into Google sign-in.
//   2. GET  /complete better-auth lands here post-Google (session cookie set);
//                     we mint a one-time token and 302 to the loopback server.
//   3. POST /exchange desktop trades { token, verifier } for a bearer token
//                     after we verify SHA-256(verifier) === stored challenge.
export const desktopAuthController = new Hono<{ Bindings: Bindings }>();

// Minimal browser-facing page for the only states the user can actually see in
// the system browser (i.e. when something goes wrong before the loopback hop).
const htmlError = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>antidraw sign-in</title>` +
  `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1>Sign-in failed</h1><p>${message}</p>` +
  `<p>Close this window and try again from antidraw.</p></body>`;

const startQuerySchema = z.object({
  redirect_uri: z.string(),
  code_challenge: z.string().min(1),
  state: z.string().min(1),
});

desktopAuthController.get(
  "/start",
  zValidator("query", startQuerySchema, (result, c) =>
    result.success
      ? undefined
      : c.html(htmlError("Malformed sign-in request."), 400),
  ),
  async (c) => {
    const { redirect_uri, code_challenge, state } = c.req.valid("query");

    if (!isLoopbackRedirectUri(redirect_uri)) {
      return c.html(htmlError("Invalid redirect target."), 400);
    }

    const created = await createAuthFlow(getDb(c.env), {
      state,
      codeChallenge: code_challenge,
      redirectUri: redirect_uri,
    });
    if (created.isErr()) {
      return c.html(htmlError(created.error.message), created.error.status);
    }

    // Kick off Google sign-in server-side. asResponse so we can forward the
    // PKCE/state Set-Cookie headers better-auth needs on the callback.
    const completeUrl = `${c.env.BETTER_AUTH_URL}/api/desktop/complete?state=${encodeURIComponent(state)}`;
    const res = await getAuth(c.env).api.signInSocial({
      body: { provider: "google", callbackURL: completeUrl },
      asResponse: true,
    });

    const { url } = (await res.json().catch(() => ({}))) as { url?: string };
    if (!res.ok || !url) {
      return c.html(htmlError("Could not reach Google sign-in."), 502);
    }

    const headers = new Headers({ Location: url });
    // getSetCookie() exists on the Workers runtime Headers but isn't in the
    // type; it's the only way to forward each Set-Cookie intact (commas in
    // Expires dates break a folded header).
    const setCookies = (
      res.headers as unknown as { getSetCookie: () => string[] }
    ).getSetCookie();
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  },
);

desktopAuthController.get(
  "/complete",
  zValidator("query", z.object({ state: z.string().min(1) }), (result, c) =>
    result.success
      ? undefined
      : c.html(htmlError("Malformed sign-in callback."), 400),
  ),
  async (c) => {
    const { state } = c.req.valid("query");

    const flow = await peekAuthFlow(getDb(c.env), state);
    if (flow.isErr() || !flow.value) {
      return c.html(htmlError("This sign-in link has expired."), 400);
    }

    // Session cookie was set during the Google callback; turn it into a
    // single-use token for the loopback hop.
    let token: string;
    try {
      const result = await getAuth(c.env).api.generateOneTimeToken({
        headers: c.req.raw.headers,
      });
      token = result.token;
    } catch {
      return c.html(htmlError("You are not signed in."), 401);
    }

    const redirect = new URL(flow.value.redirectUri);
    redirect.searchParams.set("token", token);
    redirect.searchParams.set("state", state);
    return c.redirect(redirect.toString(), 302);
  },
);

const exchangeSchema = z.object({
  token: z.string().min(1),
  verifier: z.string().min(1),
  state: z.string().min(1),
});

desktopAuthController.post(
  "/exchange",
  zValidator("json", exchangeSchema),
  async (c) => {
    const { token, verifier, state } = c.req.valid("json");

    const flow = await consumeAuthFlow(getDb(c.env), state);
    if (flow.isErr() || !flow.value) {
      return c.json(
        { error: { code: "INVALID_STATE", message: "Unknown or expired sign-in" } },
        400,
      );
    }

    if ((await sha256Base64Url(verifier)) !== flow.value.codeChallenge) {
      return c.json(
        { error: { code: "INVALID_VERIFIER", message: "PKCE verification failed" } },
        400,
      );
    }

    try {
      const result = await getAuth(c.env).api.verifyOneTimeToken({
        body: { token },
      });
      // result.session.token is the bearer the desktop sends as
      // `Authorization: Bearer <token>` on every cloud request.
      return c.json({ token: result.session.token, user: result.user });
    } catch {
      return c.json(
        { error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } },
        400,
      );
    }
  },
);

import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
  signInSocial,
} from "better-auth/api";
import {
  deleteSessionCookie,
  parseSetCookieHeader,
  toCookieOptions,
} from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import { z } from "zod";
import type { ApiError } from "./errors";
import {
  FLOW_TTL_MS,
  issueDesktopCode,
  loopbackRedirect,
  redeemDesktopCode,
  startDesktopFlow,
  takeDesktopFlow,
  toPublicUser,
} from "../services/auth.service";

// Endpoints for the desktop sign-in flow (see services/auth.service.ts for the
// protocol). A better-auth plugin rather than plain Hono routes because the
// flow needs better-auth's own context: its verification store, session
// creation, and the Google provider — none of which are public on `auth.api`.
// Endpoints stay thin; the flow logic lives in the service.
//
//   GET  /api/auth/desktop/start     app opens this in the system browser
//   GET  /api/auth/desktop/callback  better-auth lands here after Google
//   POST /api/auth/desktop/token     app trades { code, code_verifier } for a
//                                    bearer session token

// Binds a flow to the browser that started it, so a /callback URL replayed in
// another browser (or one that merely has a better-auth session) goes nowhere.
const FLOW_COOKIE = "desktop_flow";

const state = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

const startQuery = z.object({
  redirect_uri: z.string().max(200),
  // base64url(SHA-256(verifier)) is always 43 chars; S256 is the only method.
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state,
});

const callbackQuery = z.object({
  state,
  // Set by better-auth when the Google leg fails (errorCallbackURL).
  error: z.string().max(200).optional(),
});

const tokenBody = z.object({
  code: z.string().min(1).max(128),
  // RFC 7636 §4.1.
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// The browser legs can fail before we know where the app is listening, so the
// only place left to tell the user is the browser tab itself.
const errorPage = (error: ApiError) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>antidraw sign-in</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>Sign-in failed</h1><p>${escapeHtml(error.message)}</p>` +
      `<p>Close this tab and try again from antidraw.</p></body>`,
    {
      status: error.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );

const toAPIError = (error: ApiError) =>
  APIError.from(error.status as 400, { code: error.code, message: error.message });

export const desktopAuth = () =>
  ({
    id: "desktop-auth",
    endpoints: {
      desktopStart: createAuthEndpoint(
        "/desktop/start",
        { method: "GET", query: startQuery },
        async (ctx) => {
          const { state, code_challenge, redirect_uri } = ctx.query;

          const started = await startDesktopFlow(ctx.context.internalAdapter, {
            state,
            codeChallenge: code_challenge,
            redirectUri: redirect_uri,
          });
          if (started.isErr()) return errorPage(started.error);

          const flowCookie = ctx.context.createAuthCookie(FLOW_COOKIE, {
            maxAge: FLOW_TTL_MS / 1000,
          });
          await ctx.setSignedCookie(
            flowCookie.name,
            state,
            ctx.context.secret,
            flowCookie.attributes,
          );

          // Start Google sign-in in-process (no HTTP round trip to ourselves).
          // Success and failure both come back to /callback; failure carries
          // `?error=`, which /callback relays to the app.
          const callbackURL = `${ctx.context.baseURL}/desktop/callback?state=${state}`;
          const { headers, response } = await signInSocial()({
            ...ctx,
            method: "POST",
            query: {},
            body: { provider: "google", callbackURL, errorCallbackURL: callbackURL },
            asResponse: false,
            returnHeaders: true,
          });

          // better-auth's OAuth state cookie has to reach the browser, or the
          // Google callback is rejected. parseSetCookieHeader splits the
          // combined header itself.
          parseSetCookieHeader(headers.get("set-cookie") ?? "").forEach((attrs, name) => {
            ctx.setCookie(name, attrs.value, toCookieOptions(attrs));
          });

          if (!response.url) {
            return errorPage({
              status: 502,
              code: "GOOGLE_UNAVAILABLE",
              message: "Could not start Google sign-in.",
            });
          }
          throw ctx.redirect(response.url);
        },
      ),

      desktopCallback: createAuthEndpoint(
        "/desktop/callback",
        { method: "GET", query: callbackQuery },
        async (ctx) => {
          const { state, error } = ctx.query;

          const flowCookie = ctx.context.createAuthCookie(FLOW_COOKIE);
          const boundState = await ctx.getSignedCookie(
            flowCookie.name,
            ctx.context.secret,
          );
          // A mismatched cookie may belong to a newer flow in another tab, so
          // it is only cleared once it has been used. Nothing else happens
          // before this check: the route is a GET any page can navigate to.
          if (boundState !== state) {
            return errorPage({
              status: 400,
              code: "FLOW_MISMATCH",
              message: "This sign-in was started in a different browser.",
            });
          }
          ctx.setCookie(flowCookie.name, "", { ...flowCookie.attributes, maxAge: 0 });

          // The browser session only carried the user from Google to here; the
          // app gets its own at /token. Drop it before anything else can bail
          // out, so no exit past the state check leaves the browser signed in
          // on the Worker's domain. The cookie goes even when the lookup
          // failed (better-auth reports a failed lookup as no session).
          const session = await getSessionFromCtx(ctx);
          if (session) {
            await ctx.context.internalAdapter.deleteSession(session.session.token);
          }
          deleteSessionCookie(ctx);

          const flow = await takeDesktopFlow(ctx.context.internalAdapter, state);
          if (flow.isErr()) return errorPage(flow.error);
          const { redirectUri, codeChallenge, startedAt } = flow.value;

          if (error || !session) {
            // No error from better-auth and no session means the session
            // lookup failed, not that the user declined.
            throw ctx.redirect(
              loopbackRedirect(redirectUri, { error: error ?? "server_error", state }),
            );
          }
          // Only the session Google just created for this flow counts. One
          // that predates /start (a web sign-in on this origin) would hand a
          // code to whoever started the flow without the Google step.
          if (session.session.createdAt.getTime() < startedAt) {
            throw ctx.redirect(loopbackRedirect(redirectUri, { error: "access_denied", state }));
          }

          const code = await issueDesktopCode(ctx.context.internalAdapter, {
            userId: session.user.id,
            codeChallenge,
          });
          throw ctx.redirect(
            loopbackRedirect(
              redirectUri,
              code.isOk() ? { code: code.value, state } : { error: "server_error", state },
            ),
          );
        },
      ),

      desktopToken: createAuthEndpoint(
        "/desktop/token",
        { method: "POST", body: tokenBody },
        async (ctx) => {
          const redeemed = await redeemDesktopCode(ctx.context.internalAdapter, {
            code: ctx.body.code,
            codeVerifier: ctx.body.code_verifier,
          });
          if (redeemed.isErr()) throw toAPIError(redeemed.error);

          const user = await ctx.context.internalAdapter.findUserById(
            redeemed.value.userId,
          );
          if (!user) {
            throw toAPIError({
              status: 400,
              code: "INVALID_CODE",
              message: "Invalid or expired code",
            });
          }

          // A fresh session just for this app install — independent of any
          // browser session, revocable on its own. The token is signed, the
          // same form as the session cookie: auth.ts sets
          // bearer({ requireSignature: true }), so the raw tokens better-auth
          // returns from /list-sessions don't work as credentials.
          const session = await ctx.context.internalAdapter.createSession(user.id);
          const signature = await makeSignature(session.token, ctx.context.secret);
          return ctx.json({
            token: `${session.token}.${signature}`,
            expiresAt: session.expiresAt,
            user: toPublicUser(user),
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

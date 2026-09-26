import { generateCodeChallenge } from "better-auth/oauth2";
import { generateRandomString } from "better-auth/crypto";
import { err, ok, errAsync, okAsync, ResultAsync, type Result } from "neverthrow";
import { z } from "zod";
import { apiError, type ApiError } from "../lib/errors";

// Desktop (Electron) sign-in: system browser + loopback redirect + PKCE, per
// RFC 8252 §7.3 (OAuth for native apps) and RFC 7636 (S256 only). The browser
// signs in with Google against this Worker; the app never talks to Google and
// never holds a Google secret. Two short-lived rows in better-auth's
// `verification` table carry the flow, each consumed atomically so every hop
// is single-use:
//
//   desktop-flow:<state>  { redirectUri, codeChallenge }   /start    -> /callback
//   desktop-code:<code>   { userId, codeChallenge }        /callback -> /token
//
// The code alone is useless: /token also needs the PKCE verifier, which never
// leaves the app instance that started the flow.

// Spans an interactive Google sign-in (account picker, 2FA, consent).
export const FLOW_TTL_MS = 10 * 60 * 1000;
// Browser -> loopback -> /token is immediate; keep the code's window tiny.
const CODE_TTL_MS = 60 * 1000;

const flowKey = (state: string) => `desktop-flow:${state}`;
const codeKey = (code: string) => `desktop-code:${code}`;

// The slice of better-auth's internalAdapter this flow needs. Typed
// structurally so the service does not depend on better-auth internals and
// tests can pass an in-memory store.
export type VerificationStore = {
  reserveVerificationValue(data: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<boolean>;
  createVerificationValue(data: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<unknown>;
  consumeVerificationValue(identifier: string): Promise<{ value: string } | null>;
};

const flowValue = z.object({
  redirectUri: z.string(),
  codeChallenge: z.string(),
});
export type DesktopFlow = z.infer<typeof flowValue>;

const codeValue = z.object({
  userId: z.string(),
  codeChallenge: z.string(),
});

const parseStored = <T>(schema: z.ZodType<T>, raw: string): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const storeFailure = () =>
  apiError(500, "DESKTOP_AUTH_STORE_FAILED", "Could not reach sign-in storage");

// Only http://127.0.0.1:<port>/callback. RFC 8252 §8.3 prefers the IP literal
// over "localhost" (which can be re-pointed via hosts files), the port must be
// explicit since the app binds an ephemeral one, and the fixed path + no query
// keeps this from becoming an open redirect that leaks a code.
export const parseLoopbackRedirectUri = (raw: string): Result<string, ApiError> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err(invalidRedirect());
  }
  const isLoopback =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port !== "" &&
    url.pathname === "/callback" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "";
  return isLoopback ? ok(url.toString()) : err(invalidRedirect());
};

const invalidRedirect = () =>
  apiError(
    400,
    "INVALID_REDIRECT_URI",
    "redirect_uri must be http://127.0.0.1:<port>/callback",
  );

// Records a pending flow keyed by the app's `state`. First writer wins, so a
// replayed /start cannot re-point an in-flight flow at another redirect.
export const startDesktopFlow = (
  store: VerificationStore,
  input: { state: string; codeChallenge: string; redirectUri: string },
): ResultAsync<void, ApiError> =>
  parseLoopbackRedirectUri(input.redirectUri).asyncAndThen((redirectUri) =>
    ResultAsync.fromPromise(
      store.reserveVerificationValue({
        identifier: flowKey(input.state),
        value: JSON.stringify({
          redirectUri,
          codeChallenge: input.codeChallenge,
        } satisfies DesktopFlow),
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      }),
      storeFailure,
    ).andThen((reserved) =>
      reserved
        ? okAsync(undefined)
        : errAsync(
            apiError(409, "FLOW_ALREADY_STARTED", "This sign-in has already started"),
          ),
    ),
  );

// Consumes the pending flow for `state`. Expired, unknown and already-used
// flows all read as expired: the user's only move is to start again.
export const takeDesktopFlow = (
  store: VerificationStore,
  state: string,
): ResultAsync<DesktopFlow, ApiError> =>
  ResultAsync.fromPromise(store.consumeVerificationValue(flowKey(state)), storeFailure)
    .map((row) => (row ? parseStored(flowValue, row.value) : null))
    .andThen((flow) =>
      flow
        ? okAsync(flow)
        : errAsync(
            apiError(
              400,
              "FLOW_EXPIRED",
              "This sign-in link has expired. Start again from antidraw.",
            ),
          ),
    );

// Mints the single-use code handed to the loopback server, bound to the
// signed-in user and the flow's PKCE challenge.
export const issueDesktopCode = (
  store: VerificationStore,
  input: { userId: string; codeChallenge: string },
): ResultAsync<string, ApiError> => {
  const code = generateRandomString(43, "a-z", "A-Z", "0-9");
  return ResultAsync.fromPromise(
    store.createVerificationValue({
      identifier: codeKey(code),
      value: JSON.stringify(input),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    }),
    storeFailure,
  ).map(() => code);
};

// Redeems a code for the user it was issued to. The code is consumed before
// the verifier is checked, so a wrong guess burns it — no retries against the
// same code.
export const redeemDesktopCode = (
  store: VerificationStore,
  input: { code: string; codeVerifier: string },
): ResultAsync<{ userId: string }, ApiError> =>
  ResultAsync.fromPromise(store.consumeVerificationValue(codeKey(input.code)), storeFailure)
    .map((row) => (row ? parseStored(codeValue, row.value) : null))
    .andThen((stored) => {
      if (!stored) {
        return errAsync(apiError(400, "INVALID_CODE", "Invalid or expired code"));
      }
      return ResultAsync.fromPromise(generateCodeChallenge(input.codeVerifier), () =>
        apiError(400, "INVALID_CODE_VERIFIER", "PKCE verification failed"),
      ).andThen((challenge) =>
        challenge === stored.codeChallenge
          ? okAsync({ userId: stored.userId })
          : errAsync(apiError(400, "INVALID_CODE_VERIFIER", "PKCE verification failed")),
      );
    });

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

// The user as clients see it. An explicit allowlist, so columns added to the
// user table later (by us or a better-auth plugin) don't leak by default.
export const toPublicUser = (user: {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image ?? null,
});

// The loopback URL the browser is sent back to, e.g. with { code, state } or
// { error, state }. redirectUri has already passed parseLoopbackRedirectUri.
export const loopbackRedirect = (
  redirectUri: string,
  params: Record<string, string>,
): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

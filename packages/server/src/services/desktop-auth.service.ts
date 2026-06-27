import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { Db } from "../db";
import { desktopAuthFlow } from "../db/schema";
import { apiError, type ApiError } from "../lib/errors";

// How long the whole browser sign-in has to complete (start -> Google -> back).
// Generous because it spans an interactive Google login.
const FLOW_TTL_MS = 10 * 60 * 1000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Open-redirect guard: the desktop app's redirect_uri must be a loopback
// http://127.0.0.1:<port>/callback (or localhost / [::1]). Anything else could
// turn /api/desktop/complete into an open redirect that leaks a one-time token.
export const isLoopbackRedirectUri = (uri: string): boolean => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.pathname === "/callback"
  );
};

const base64UrlEncode = (bytes: ArrayBuffer): string => {
  let str = "";
  for (const byte of new Uint8Array(bytes)) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// PKCE S256: the challenge stored at /start must equal SHA-256(verifier) sent
// at /exchange, so an intercepted loopback callback is useless without the
// verifier held only by the originating app instance.
export const sha256Base64Url = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return base64UrlEncode(digest);
};

export type AuthFlow = typeof desktopAuthFlow.$inferSelect;

export const createAuthFlow = (
  db: Db,
  params: { state: string; codeChallenge: string; redirectUri: string },
): ResultAsync<void, ApiError> =>
  ResultAsync.fromPromise(
    db
      .insert(desktopAuthFlow)
      .values({
        state: params.state,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      })
      .run(),
    () => apiError(500, "FLOW_CREATE_FAILED", "Could not start sign-in"),
  ).map(() => undefined);

// Read without consuming — /complete needs the redirect URI but the row must
// survive for /exchange to check the verifier. Returns null if missing/expired.
export const peekAuthFlow = (
  db: Db,
  state: string,
): ResultAsync<AuthFlow | null, ApiError> =>
  ResultAsync.fromPromise(
    db
      .select()
      .from(desktopAuthFlow)
      .where(eq(desktopAuthFlow.state, state))
      .get(),
    () => apiError(500, "FLOW_READ_FAILED", "Could not read sign-in state"),
  ).map((row) => (row && row.expiresAt > new Date() ? row : null));

// Atomically read + delete for /exchange (single use). Returns null if
// missing/expired; the row is gone either way once we've read it.
export const consumeAuthFlow = (
  db: Db,
  state: string,
): ResultAsync<AuthFlow | null, ApiError> =>
  peekAuthFlow(db, state).andThen((flow) =>
    ResultAsync.fromPromise(
      db.delete(desktopAuthFlow).where(eq(desktopAuthFlow.state, state)).run(),
      () => apiError(500, "FLOW_DELETE_FAILED", "Could not finish sign-in"),
    ).map(() => flow),
  );

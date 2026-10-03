import { app, net, safeStorage, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { SIGN_IN_PAGE_HEADERS, signInPage, type SignInOutcome } from "./sign-in-page";

// Sign-in to the Antidraw cloud (@antidraw/server) for publish/sync. The
// session token never leaves the main process: the renderer asks for the
// account and triggers sign-in/out through /api/account, and cloud calls go
// through cloudFetch, which attaches the token here.

// Where the Worker runs: the deployed one in packaged builds, else `npm run
// dev` in packages/server.
const serverUrl = () =>
  (
    process.env.ANTIDRAW_SERVER_URL ??
    (app.isPackaged ? "https://api.antidraw.com" : "http://localhost:8799")
  ).replace(/\/$/, "");

// The Google step must finish within better-auth's OAuth state cookie
// (Max-Age 300 s); after that the server can only fail the flow, so waiting
// longer is pointless. A little extra for the redirect back.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000 + 30_000;

// How long a request to the Worker may take before it counts as unreachable.
const REQUEST_TIMEOUT_MS = 15_000;

export type Account = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type AccountError = {
  status: 401 | 408 | 409 | 500 | 502;
  code:
    | "SIGNED_OUT"
    | "CANCELLED"
    | "TIMED_OUT"
    | "ACCESS_DENIED"
    | "SIGN_IN_FAILED"
    | "SERVER_UNREACHABLE"
    | "SERVER_ERROR";
  message: string;
};

const accountError = (
  status: AccountError["status"],
  code: AccountError["code"],
  message: string,
): AccountError => ({ status, code, message });

const SIGNED_OUT = accountError(401, "SIGNED_OUT", "Not signed in");
const CANCELLED = accountError(409, "CANCELLED", "Sign-in was cancelled");
const UNREACHABLE = accountError(
  502,
  "SERVER_UNREACHABLE",
  "Couldn't reach the Antidraw server",
);

// ============================================================================
// Token storage
// ============================================================================

// Encrypted with the OS keychain via safeStorage. `undefined` = not read yet.
let token: string | null | undefined;

const tokenFile = () => path.join(app.getPath("userData"), "cloud-session");

const loadToken = async () => {
  if (token !== undefined) return token;
  try {
    token = safeStorage.decryptString(await fs.readFile(tokenFile()));
  } catch {
    token = null;
  }
  return token;
};

const saveToken = async (value: string) => {
  token = value;
  // Without OS encryption (some Linux setups) the token is kept in memory
  // only, so the user stays signed in until quit rather than on disk in clear.
  // A file from an earlier sign-in would bring that account back next launch.
  if (!safeStorage.isEncryptionAvailable()) {
    await fs.rm(tokenFile(), { force: true }).catch(() => {});
    return;
  }
  try {
    await fs.writeFile(tokenFile(), safeStorage.encryptString(value), {
      mode: 0o600,
    });
  } catch (e) {
    console.error("Failed to persist cloud session:", e);
  }
};

const clearToken = async () => {
  token = null;
  await fs.rm(tokenFile(), { force: true }).catch(() => {});
};

// ============================================================================
// Cloud requests
// ============================================================================

// Requests to the Worker go through Electron's net.fetch, which uses the
// system proxy and certificate store as the browser does; Node's fetch
// doesn't, so on a proxied network the browser would sign in and the app
// couldn't. Unlike Node's fetch, net.fetch would share the default session's
// cookies (workspace previews set those, and better-auth refuses a cookie
// request without an Origin) and would keep the Authorization header on a
// redirect to another host. The Worker never redirects and its API takes no
// cookies, so both are turned off.
const workerFetch = (url: string, init: RequestInit = {}) =>
  net.fetch(url, { ...init, credentials: "omit", redirect: "error" });

// A request to the Worker as the signed-in user: a path, or a URL the Worker
// handed out (the token only ever goes to the Worker). A 401 means the token is dead
// (expired, or signed out elsewhere), so it's dropped and the caller gets
// SIGNED_OUT, which the renderer answers by asking the user to sign in again.
export const cloudFetch = async (
  pathname: string,
  init: RequestInit = {},
): Promise<Result<Response, AccountError>> => {
  const url = new URL(pathname, serverUrl());
  if (url.origin !== new URL(serverUrl()).origin) {
    return err(accountError(502, "SERVER_ERROR", "Refused to send the session to another host"));
  }
  const current = await loadToken();
  if (!current) return err(SIGNED_OUT);

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${current}`);

  let response: Response;
  try {
    response = await workerFetch(url.href, { ...init, headers });
  } catch {
    return err(UNREACHABLE);
  }

  if (response.status === 401) {
    // Only the token this request carried: one saved meanwhile is still good.
    if (token === current) await clearToken();
    return err(SIGNED_OUT);
  }
  return ok(response);
};

export const getAccount = async (): Promise<
  Result<Account | null, AccountError>
> => {
  const result = await cloudFetch("/api/me", {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (result.isErr()) {
    return result.error.code === "SIGNED_OUT" ? ok(null) : err(result.error);
  }
  if (!result.value.ok) {
    return err(accountError(502, "SERVER_ERROR", "Couldn't load the account"));
  }
  try {
    const body = (await result.value.json()) as { user: Account };
    return ok(body.user);
  } catch (error) {
    // A captive portal's page, or a body that outlasted the timeout (an
    // AbortError under net.fetch, a TimeoutError under Node's fetch).
    return err(
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? UNREACHABLE
        : accountError(502, "SERVER_ERROR", "Couldn't load the account"),
    );
  }
};

// Best effort: ends a token's session on the server. Offline, the session
// just expires there. better-auth refuses the request (415) without a JSON body.
const revoke = async (value: string) => {
  const response = await workerFetch(`${serverUrl()}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${value}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (response && !response.ok && response.status !== 401) {
    console.error(`Server sign-out failed: ${response.status}`);
  }
};

export const signOut = async (): Promise<Result<true, never>> => {
  const current = await loadToken();
  // Forgotten here even if the server can't be told, which is what signing
  // out means to the user.
  if (current) await revoke(current);
  await clearToken();
  return ok(true);
};

// ============================================================================
// Sign-in (RFC 8252 loopback + PKCE, see packages/server/README.md)
// ============================================================================

// At most one flow at a time. Starting another, or cancelling, aborts it.
let pendingSignIn: AbortController | null = null;

export const cancelSignIn = () => {
  pendingSignIn?.abort();
  pendingSignIn = null;
};

export const signIn = async (): Promise<Result<Account, AccountError>> => {
  cancelSignIn();
  const controller = new AbortController();
  pendingSignIn = controller;

  try {
    // A Worker that's down would otherwise leave the user on a browser error
    // page while the app waits out the whole flow. (A flow the server fails
    // later, on its own error page, still waits out the timeout, or Cancel.)
    const reachable = await workerFetch(`${serverUrl()}/api/health`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (controller.signal.aborted) return err(CANCELLED);
    if (!reachable) return err(UNREACHABLE);

    const browser = await signInWithBrowser(controller.signal);
    if (browser.isErr()) return err(browser.error);

    const { code, verifier, reply } = browser.value;
    const result = await exchange(code, verifier, controller.signal);
    // The browser tab says what actually happened, now that it's known.
    reply(result.isOk() ? "signed-in" : result.error.code === "CANCELLED" ? "cancelled" : "failed");
    return result;
  } finally {
    if (pendingSignIn === controller) pendingSignIn = null;
  }
};

// Swaps the authorization code for a session token and keeps it. A cancel
// that lands before the token is saved wins: nothing is kept.
const exchange = async (
  code: string,
  verifier: string,
  signal: AbortSignal,
): Promise<Result<Account, AccountError>> => {
  let body: { token: string; user: Account };
  try {
    const response = await workerFetch(`${serverUrl()}/api/auth/desktop/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      return err(accountError(502, "SIGN_IN_FAILED", "Sign-in failed"));
    }
    body = (await response.json()) as { token: string; user: Account };
  } catch {
    return err(signal.aborted ? CANCELLED : UNREACHABLE);
  }
  // Signing in again replaces the token here; its server session would
  // otherwise stay valid with no copy left to end it.
  const previous = await loadToken();
  // Last point a cancel can still win (the request itself aborts on one).
  if (signal.aborted) return err(CANCELLED);
  await saveToken(body.token);
  if (previous && previous !== body.token) void revoke(previous);
  return ok(body.user);
};

// What better-auth sends back when the Google step outlived its state cookie.
const STATE_EXPIRED = new Set([
  "state_mismatch",
  "state_security_mismatch",
  "please_restart_the_process",
]);

type BrowserResult = {
  code: string;
  verifier: string;
  /** Answers the browser tab, which waits until the sign-in has finished. */
  reply: (outcome: SignInOutcome) => void;
};

// Opens the system browser on the server's /desktop/start and waits for it to
// come back to a one-shot server on 127.0.0.1 with the authorization code.
const signInWithBrowser = (signal: AbortSignal) =>
  new Promise<Result<BrowserResult, AccountError>>(
    (resolve) => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const state = randomBytes(16).toString("base64url");

      const finish = (result: Result<BrowserResult, AccountError>) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        // Stops listening; the tab's own connection stays open until replied to.
        server.close();
        if (result.isErr()) server.closeAllConnections();
        resolve(result);
      };

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        // Any local process can hit this port; only the redirect that carries
        // this flow's state ends it.
        if (
          url.pathname !== "/callback" ||
          url.searchParams.get("state") !== state
        ) {
          res.writeHead(404).end();
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const reply = (outcome: SignInOutcome) => {
          res.writeHead(200, SIGN_IN_PAGE_HEADERS).end(signInPage(outcome));
          server.closeAllConnections();
        };

        if (code) {
          finish(ok({ code, verifier, reply }));
          return;
        }
        reply("failed");
        if (STATE_EXPIRED.has(error ?? ""))
          finish(err(accountError(408, "TIMED_OUT", "Sign-in took too long")));
        else if (error === "access_denied")
          finish(err(accountError(401, "ACCESS_DENIED", "Sign-in was declined")));
        else finish(err(accountError(502, "SIGN_IN_FAILED", "Sign-in failed")));
      });

      const onAbort = () => finish(err(CANCELLED));
      signal.addEventListener("abort", onAbort);

      const timer = setTimeout(
        () =>
          finish(
            err(accountError(408, "TIMED_OUT", "Timed out waiting for the browser")),
          ),
        SIGN_IN_TIMEOUT_MS,
      );

      server.on("error", () =>
        finish(err(accountError(500, "SIGN_IN_FAILED", "Couldn't start sign-in"))),
      );

      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        const start = new URL(`${serverUrl()}/api/auth/desktop/start`);
        start.search = new URLSearchParams({
          redirect_uri: `http://127.0.0.1:${port}/callback`,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        }).toString();
        shell
          .openExternal(start.toString())
          .catch(() =>
            finish(
              err(accountError(500, "SIGN_IN_FAILED", "Couldn't open the browser")),
            ),
          );
      });
    },
  );

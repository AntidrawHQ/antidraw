import { app, safeStorage, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";

// Sign-in to the AntiDraw cloud (@antidraw/server) for publish/sync. The
// session token never leaves the main process: the renderer asks for the
// account and triggers sign-in/out through /api/account, and cloud calls go
// through cloudFetch, which attaches the token here.

// Where the Worker runs. Defaults to `npm run dev` in packages/server.
// TODO: point packaged builds at the deployed Worker once it has a URL.
const SERVER_URL = (
  process.env.ANTIDRAW_SERVER_URL ?? "http://localhost:8799"
).replace(/\/$/, "");

// The server only honors a flow for about this long (better-auth's OAuth state
// cookie), so waiting on the browser any longer is pointless.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

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
const UNREACHABLE = accountError(
  502,
  "SERVER_UNREACHABLE",
  "Couldn't reach the AntiDraw server",
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
  if (!safeStorage.isEncryptionAvailable()) return;
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

// A request to the Worker as the signed-in user. A 401 means the token is dead
// (expired, or signed out elsewhere), so it's dropped and the caller gets
// SIGNED_OUT, which the renderer answers by asking the user to sign in again.
export const cloudFetch = async (
  pathname: string,
  init: RequestInit = {},
): Promise<Result<Response, AccountError>> => {
  const current = await loadToken();
  if (!current) return err(SIGNED_OUT);

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${current}`);

  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}${pathname}`, { ...init, headers });
  } catch {
    return err(UNREACHABLE);
  }

  if (response.status === 401) {
    await clearToken();
    return err(SIGNED_OUT);
  }
  return ok(response);
};

export const getAccount = async (): Promise<
  Result<Account | null, AccountError>
> => {
  const result = await cloudFetch("/api/me");
  if (result.isErr()) {
    return result.error.code === "SIGNED_OUT" ? ok(null) : err(result.error);
  }
  if (!result.value.ok) {
    return err(accountError(502, "SERVER_ERROR", "Couldn't load the account"));
  }
  const body = (await result.value.json()) as { user: Account };
  return ok(body.user);
};

export const signOut = async (): Promise<Result<true, never>> => {
  const current = await loadToken();
  if (current) {
    // Best effort: ends the session on the server too. Offline, the token is
    // still forgotten here, which is what signing out means to the user.
    // better-auth refuses the request (415) without a JSON body.
    const response = await fetch(`${SERVER_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${current}`,
        "content-type": "application/json",
      },
      body: "{}",
    }).catch(() => null);
    if (response && !response.ok && response.status !== 401) {
      console.error(`Server sign-out failed: ${response.status}`);
    }
  }
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
    const browser = await signInWithBrowser(controller.signal);
    if (browser.isErr()) return err(browser.error);

    let response: Response;
    try {
      response = await fetch(`${SERVER_URL}/api/auth/desktop/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: browser.value.code,
          code_verifier: browser.value.verifier,
        }),
      });
    } catch {
      return err(UNREACHABLE);
    }
    if (!response.ok) {
      return err(accountError(502, "SIGN_IN_FAILED", "Sign-in failed"));
    }

    const body = (await response.json()) as { token: string; user: Account };
    await saveToken(body.token);
    return ok(body.user);
  } finally {
    if (pendingSignIn === controller) pendingSignIn = null;
  }
};

const CLOSE_TAB_PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>AntiDraw</title>` +
  `<body style="font:14px system-ui;background:#262626;color:#e0e0e0;display:grid;place-items:center;height:100vh;margin:0">` +
  `<p>${message}</p>`;

// Opens the system browser on the server's /desktop/start and waits for it to
// come back to a one-shot server on 127.0.0.1 with the authorization code.
const signInWithBrowser = (signal: AbortSignal) =>
  new Promise<Result<{ code: string; verifier: string }, AccountError>>(
    (resolve) => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const state = randomBytes(16).toString("base64url");

      const finish = (
        result: Result<{ code: string; verifier: string }, AccountError>,
      ) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        server.close();
        server.closeAllConnections();
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
        res
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(
            CLOSE_TAB_PAGE(
              code
                ? "Signed in. You can close this tab and return to AntiDraw."
                : "Sign-in didn't complete. You can close this tab and try again in AntiDraw.",
            ),
          );

        if (code) finish(ok({ code, verifier }));
        else if (error === "access_denied")
          finish(err(accountError(401, "ACCESS_DENIED", "Sign-in was declined")));
        else finish(err(accountError(502, "SIGN_IN_FAILED", "Sign-in failed")));
      });

      const onAbort = () =>
        finish(err(accountError(409, "CANCELLED", "Sign-in was cancelled")));
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
        const start = new URL(`${SERVER_URL}/api/auth/desktop/start`);
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

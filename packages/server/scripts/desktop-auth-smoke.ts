// Standalone stand-in for the Electron client (Phase B) to exercise the full
// /api/desktop/* loopback sign-in against a running Worker + real Google.
//
//   cd packages/server && npx wrangler dev --port 8799   # in one terminal
//   npx tsx scripts/desktop-auth-smoke.ts                # in another
//
// It generates a PKCE verifier/challenge, starts a 127.0.0.1 loopback server,
// opens the system browser to /api/desktop/start, catches the redirect,
// exchanges the one-time token for a bearer token, and calls /api/me with it.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { AddressInfo } from "node:net";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8799";

const base64url = (buf: Buffer) => buf.toString("base64url");
const codeVerifier = base64url(randomBytes(32));
const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
const state = base64url(randomBytes(16));

const openBrowser = (url: string) => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} "${url}"`);
};

const fail = (msg: string): never => {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const respond = (body: string) =>
    res.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><meta charset="utf-8"><title>antidraw smoke</title>` +
        `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;text-align:center">${body}</body>`,
    );

  try {
    const token = url.searchParams.get("token");
    const returnedState = url.searchParams.get("state");
    if (returnedState !== state) throw new Error(`state mismatch (csrf guard)`);
    if (!token) throw new Error("no token in callback");

    console.log("→ callback received, exchanging one-time token…");
    const exchangeRes = await fetch(`${BASE_URL}/api/desktop/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, verifier: codeVerifier, state }),
    });
    const exchange = (await exchangeRes.json()) as {
      token?: string;
      user?: unknown;
      error?: { code: string; message: string };
    };
    if (!exchangeRes.ok || !exchange.token) {
      throw new Error(`exchange failed: ${JSON.stringify(exchange.error ?? exchange)}`);
    }

    console.log("✓ got bearer token; user:", JSON.stringify(exchange.user));
    console.log("→ calling /api/me with the bearer token…");
    const meRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: `Bearer ${exchange.token}` },
    });
    const me = await meRes.json();
    console.log(`✓ /api/me [${meRes.status}]:`, JSON.stringify(me));

    respond("<h1>✓ Signed in</h1><p>You can close this tab and return to the terminal.</p>");
    console.log("\n✅ Full loopback flow succeeded.");
    server.close();
    setTimeout(() => process.exit(0), 100);
  } catch (err) {
    respond(`<h1>❌ Failed</h1><p>${(err as Error).message}</p>`);
    fail((err as Error).message);
  }
});

let port = 0;
server.listen(0, "127.0.0.1", () => {
  port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const startUrl =
    `${BASE_URL}/api/desktop/start?` +
    new URLSearchParams({
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state,
    }).toString();

  console.log(`Loopback server on ${redirectUri}`);
  console.log("Opening browser to start sign-in. Approve Google sign-in in the browser.\n");
  console.log(`If it doesn't open, visit:\n${startUrl}\n`);
  openBrowser(startUrl);
});

setTimeout(() => fail("timed out waiting for sign-in (5 min)"), 5 * 60 * 1000);

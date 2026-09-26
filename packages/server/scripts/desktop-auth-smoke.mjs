// Stand-in for the Electron client: runs the full desktop sign-in against a
// running Worker, with real Google, and prints the signed-in user.
//
//   npm run dev                                   # in packages/server
//   node scripts/desktop-auth-smoke.mjs           # defaults to localhost:8787
//   node scripts/desktop-auth-smoke.mjs https://<worker-host>
//
// Same steps the app will take: PKCE pair + state, a one-shot loopback server
// on 127.0.0.1, the system browser to /api/auth/desktop/start, then the code +
// verifier exchanged for a bearer token at /api/auth/desktop/token.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("base64url");

const callback = new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("antidraw: you can close this tab.");
    server.close();
    if (url.searchParams.get("state") !== state) {
      reject(new Error("state mismatch on loopback callback"));
    } else if (url.searchParams.get("error")) {
      reject(new Error(`sign-in failed: ${url.searchParams.get("error")}`));
    } else {
      resolve(url.searchParams.get("code"));
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const start = new URL(`${base}/api/auth/desktop/start`);
    start.search = new URLSearchParams({
      redirect_uri: `http://127.0.0.1:${port}/callback`,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString();
    console.log(`Opening the browser to sign in:\n  ${start}\n`);
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    execFile(opener, [start.toString()], () => {});
  });
  setTimeout(() => reject(new Error("timed out waiting for the browser")), 5 * 60 * 1000).unref();
});

const code = await callback;

const tokenRes = await fetch(`${base}/api/auth/desktop/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, code_verifier: verifier }),
});
const token = await tokenRes.json();
if (!tokenRes.ok) throw new Error(`token exchange failed: ${JSON.stringify(token)}`);
console.log(`Got a session token (expires ${token.expiresAt}).`);

const meRes = await fetch(`${base}/api/me`, {
  headers: { authorization: `Bearer ${token.token}` },
});
console.log(`GET /api/me -> ${meRes.status}`, await meRes.json());

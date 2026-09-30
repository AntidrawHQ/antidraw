import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// Sign-in and the cloud session in main, against a stand-in Worker on a local
// port and a "browser" that follows the Worker's redirect to the app's
// loopback server, as Google sign-in ends. Electron is faked: userData is a
// temp dir, and safeStorage "encrypts" with a visible prefix.

const electron = vi.hoisted(() => ({
  userData: "",
  encryption: true,
  // What the browser tab showed at the end of each sign-in.
  pages: [] as string[],
  openExternal: async (url: string) => {
    void url;
  },
}));

vi.mock("electron", () => ({
  app: { getPath: () => electron.userData, isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => electron.encryption,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^enc:/, ""),
  },
  shell: { openExternal: (url: string) => electron.openExternal(url) },
  // Electron's fetch (system proxy and certificates); plain fetch here.
  net: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
}));

// ---- the stand-in Worker ---------------------------------------------------

const worker = {
  healthy: true,
  // How Google's step ends: a code, or better-auth's ?error= value.
  google: "code" as "code" | { error: string },
  meBody: null as string | null,
  tokens: 0,
  exchange: { delayMs: 0, status: 200 },
  me: { delayMs: 0 } as { delayMs: number },
  valid: new Set<string>(),
  log: [] as string[],
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bearer = (req: IncomingMessage) => req.headers.authorization?.replace(/^Bearer /, "") ?? "";

let server: Server;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://worker");
    worker.log.push(`${req.method} ${url.pathname}${req.headers.authorization ? ` as ${bearer(req)}` : ""}`);
    if (url.pathname === "/api/health") {
      res.writeHead(worker.healthy ? 200 : 503).end();
    } else if (url.pathname === "/api/auth/desktop/start") {
      // Google's step is over at once: back to the app's loopback.
      const back = new URL(url.searchParams.get("redirect_uri")!);
      const state = url.searchParams.get("state")!;
      back.search = new URLSearchParams(
        worker.google === "code" ? { code: "the-code", state } : { error: worker.google.error, state },
      ).toString();
      res.writeHead(302, { location: back.href }).end();
    } else if (url.pathname === "/api/auth/desktop/token") {
      await sleep(worker.exchange.delayMs);
      if (worker.exchange.status !== 200) return res.writeHead(worker.exchange.status).end();
      const token = `token-${++worker.tokens}`;
      worker.valid.add(token);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ token, user: { id: "u1", name: "Ada", email: "ada@example.com", image: null } }),
      );
    } else if (url.pathname === "/api/auth/sign-out") {
      worker.valid.delete(bearer(req));
      res.writeHead(200).end("{}");
    } else if (url.pathname === "/api/me") {
      const token = bearer(req);
      await sleep(worker.me.delayMs);
      if (!worker.valid.has(token)) return res.writeHead(401).end();
      if (worker.meBody !== null) return res.writeHead(200, { "content-type": "text/html" }).end(worker.meBody);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ user: { id: "u1", name: "Ada", email: "ada@example.com", image: null } }),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTIDRAW_SERVER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  delete process.env.ANTIDRAW_SERVER_URL;
});

// The browser: follows /desktop/start to the loopback and keeps the page it shows.
const browse = async (url: string) => {
  const res = await fetch(url);
  electron.pages.push(await res.text().then((html) => /<p>(.*)<\/p>/.exec(html)?.[1] ?? html));
};

beforeEach(() => {
  electron.userData = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-account-"));
  electron.encryption = true;
  electron.pages = [];
  electron.openExternal = async (url) => {
    void browse(url);
  };
  Object.assign(worker, {
    healthy: true,
    google: "code",
    meBody: null,
    tokens: 0,
    exchange: { delayMs: 0, status: 200 },
    me: { delayMs: 0 },
    log: [],
  });
  worker.valid.clear();
  vi.resetModules();
});
afterEach(() => fs.rmSync(electron.userData, { recursive: true, force: true }));

/** A fresh copy of the service: nothing in memory, userData as the test left it. */
const service = () => import("../account.service");
const tokenOnDisk = () => {
  try {
    return fs.readFileSync(path.join(electron.userData, "cloud-session"), "utf8");
  } catch {
    return null;
  }
};
const outcome = (result: { isOk(): boolean; _unsafeUnwrap(): unknown; _unsafeUnwrapErr(): unknown }) =>
  result.isOk() ? { ok: result._unsafeUnwrap() } : { err: (result._unsafeUnwrapErr() as { code: string }).code };
/** The loopback page arrives just after signIn settles. */
const lastPage = async () => {
  await vi.waitFor(() => expect(electron.pages.length).toBeGreaterThan(0));
  return electron.pages.at(-1);
};

it("signs in, keeps the token encrypted, and tells the browser tab only after", async () => {
  const { signIn } = await service();
  const result = await signIn();
  expect({ result: outcome(result), onDisk: tokenOnDisk(), page: await lastPage(), requests: worker.log })
    .toMatchInlineSnapshot(`
      {
        "onDisk": "enc:token-1",
        "page": "Signed in. You can close this tab and return to AntiDraw.",
        "requests": [
          "GET /api/health",
          "GET /api/auth/desktop/start",
          "POST /api/auth/desktop/token",
        ],
        "result": {
          "ok": {
            "email": "ada@example.com",
            "id": "u1",
            "image": null,
            "name": "Ada",
          },
        },
      }
    `);
});

it("says the server is unreachable at once, without opening the browser", async () => {
  worker.healthy = false;
  const opened = vi.fn();
  electron.openExternal = async (url) => opened(url);
  const { signIn } = await service();
  expect({ result: outcome(await signIn()), opened: opened.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "opened": 0,
      "result": {
        "err": "SERVER_UNREACHABLE",
      },
    }
  `);
});

it("keeps nothing, and says so in the tab, when the code can't be exchanged", async () => {
  worker.exchange.status = 400;
  const { signIn } = await service();
  expect({ result: outcome(await signIn()), onDisk: tokenOnDisk(), page: await lastPage() }).toMatchInlineSnapshot(`
    {
      "onDisk": null,
      "page": "Sign-in didn't complete. You can close this tab and try again in AntiDraw.",
      "result": {
        "err": "SIGN_IN_FAILED",
      },
    }
  `);
});

it("keeps nothing when cancelled while the code is being exchanged", async () => {
  worker.exchange.delayMs = 300;
  const { signIn, cancelSignIn } = await service();
  const pending = signIn();
  await vi.waitFor(() => expect(worker.log).toContain("POST /api/auth/desktop/token"));
  cancelSignIn();
  expect({ result: outcome(await pending), onDisk: tokenOnDisk(), page: await lastPage() }).toMatchInlineSnapshot(`
    {
      "onDisk": null,
      "page": "Sign-in was cancelled in AntiDraw. You can close this tab.",
      "result": {
        "err": "CANCELLED",
      },
    }
  `);
});

it("ends the replaced session on the server when signing in again", async () => {
  const { signIn } = await service();
  await signIn();
  worker.log = [];
  await signIn();
  await vi.waitFor(() => expect(worker.log.some((line) => line.startsWith("POST /api/auth/sign-out"))).toBe(true));
  expect({ onDisk: tokenOnDisk(), requests: worker.log }).toMatchInlineSnapshot(`
    {
      "onDisk": "enc:token-2",
      "requests": [
        "GET /api/health",
        "GET /api/auth/desktop/start",
        "POST /api/auth/desktop/token",
        "POST /api/auth/sign-out as token-1",
      ],
    }
  `);
});

it("drops only the token a 401 was for, not one saved meanwhile", async () => {
  const first = await service();
  await first.signIn();
  // The server forgets token-1; a slow /api/me with it is still in flight
  // when the user signs in again.
  worker.valid.clear();
  worker.me.delayMs = 200;
  const stale = first.getAccount();
  await vi.waitFor(() => expect(worker.log).toContain("GET /api/me as token-1"));
  worker.me.delayMs = 0;
  await first.signIn();
  expect({ stale: outcome(await stale), onDisk: tokenOnDisk(), now: outcome(await first.getAccount()) })
    .toMatchInlineSnapshot(`
      {
        "now": {
          "ok": {
            "email": "ada@example.com",
            "id": "u1",
            "image": null,
            "name": "Ada",
          },
        },
        "onDisk": "enc:token-2",
        "stale": {
          "ok": null,
        },
      }
    `);
});

it("doesn't leave an earlier account's token on disk when it can't encrypt", async () => {
  await (await service()).signIn();
  const before = tokenOnDisk();
  electron.encryption = false;
  vi.resetModules();
  await (await service()).signIn();
  expect({ before, after: tokenOnDisk() }).toMatchInlineSnapshot(`
    {
      "after": null,
      "before": "enc:token-1",
    }
  `);
});

it("answers the account routes only with this launch's app key", async () => {
  // Electron hands the protocol handler no Origin, and no referrer for the
  // app's own requests, so the key is what tells them apart.
  const { accountController } = await import("../../api/controllers/account.controller");
  const { APP_KEY } = await import("../../lib/app-key");
  const keys = { "this launch's key": APP_KEY, "another key": "x".repeat(APP_KEY.length), "a prefix of it": APP_KEY.slice(0, 10), none: undefined };
  const answers = await Promise.all(
    Object.entries(keys).map(async ([name, key]) => {
      const res = await accountController.request("/", { headers: key === undefined ? {} : { "x-antidraw-app-key": key } });
      return `${name} → ${res.status}`;
    }),
  );
  expect(answers).toMatchInlineSnapshot(`
    [
      "this launch's key → 200",
      "another key → 403",
      "a prefix of it → 403",
      "none → 403",
    ]
  `);
});

it("finishes the flow only for its own state, and says how Google's step ended", async () => {
  const { signIn } = await service();
  // Another local process finds the port and knocks with a code of its own.
  let knocked: number | undefined;
  electron.openExternal = async (url) => {
    const loopback = new URL(new URL(url).searchParams.get("redirect_uri")!);
    loopback.search = "?code=attacker&state=guessed";
    knocked = (await fetch(loopback)).status;
    void browse(url);
  };
  const ownState = outcome(await signIn());
  const endings: Record<string, unknown> = {};
  electron.openExternal = async (url) => void browse(url);
  for (const error of ["access_denied", "state_mismatch", "server_error"]) {
    worker.google = { error };
    endings[error] = outcome(await signIn());
  }
  expect({ knocked, ownState, endings }).toMatchInlineSnapshot(`
    {
      "endings": {
        "access_denied": {
          "err": "ACCESS_DENIED",
        },
        "server_error": {
          "err": "SIGN_IN_FAILED",
        },
        "state_mismatch": {
          "err": "TIMED_OUT",
        },
      },
      "knocked": 404,
      "ownState": {
        "ok": {
          "email": "ada@example.com",
          "id": "u1",
          "image": null,
          "name": "Ada",
        },
      },
    }
  `);
});

it("reports a page that isn't the account as a server error, not a crash", async () => {
  const { signIn, getAccount } = await service();
  await signIn();
  worker.meBody = "<html>Sign in to the Wi-Fi</html>";
  expect(outcome(await getAccount())).toMatchInlineSnapshot(`
    {
      "err": "SERVER_ERROR",
    }
  `);
});

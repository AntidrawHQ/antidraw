import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueDesktopCode,
  loopbackRedirect,
  parseLoopbackRedirectUri,
  redeemDesktopCode,
  startDesktopFlow,
  takeDesktopFlow,
  type VerificationStore,
} from "./auth.service";

// In-memory stand-in for better-auth's verification table, with the same
// contract the service relies on: reserve is first-writer-wins, consume is
// single-use and treats expired rows as absent.
const memoryStore = (): VerificationStore => {
  const rows = new Map<string, { value: string; expiresAt: Date }>();
  return {
    async reserveVerificationValue({ identifier, value, expiresAt }) {
      if (rows.has(identifier)) return false;
      rows.set(identifier, { value, expiresAt });
      return true;
    },
    async createVerificationValue({ identifier, value, expiresAt }) {
      rows.set(identifier, { value, expiresAt });
    },
    async consumeVerificationValue(identifier) {
      const row = rows.get(identifier);
      rows.delete(identifier);
      return row && row.expiresAt > new Date() ? row : null;
    },
  };
};

// RFC 7636 Appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const STATE = "state-0123456789abcdef";
const REDIRECT = "http://127.0.0.1:53682/callback";

const startAndIssue = async (store: VerificationStore) => {
  await startDesktopFlow(store, {
    state: STATE,
    codeChallenge: CHALLENGE,
    redirectUri: REDIRECT,
  });
  const flow = (await takeDesktopFlow(store, STATE))._unsafeUnwrap();
  return (
    await issueDesktopCode(store, { userId: "user-1", codeChallenge: flow.codeChallenge })
  )._unsafeUnwrap();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLoopbackRedirectUri", () => {
  it("accepts http://127.0.0.1:<port>/callback", () => {
    expect(parseLoopbackRedirectUri(REDIRECT)._unsafeUnwrap()).toBe(REDIRECT);
  });

  it.each([
    ["localhost", "http://localhost:53682/callback"],
    ["IPv6 loopback", "http://[::1]:53682/callback"],
    ["a remote host", "http://evil.example:53682/callback"],
    ["https", "https://127.0.0.1:53682/callback"],
    ["no port", "http://127.0.0.1/callback"],
    ["another path", "http://127.0.0.1:53682/other"],
    ["a query", "http://127.0.0.1:53682/callback?next=x"],
    ["a fragment", "http://127.0.0.1:53682/callback#x"],
    ["userinfo", "http://user@127.0.0.1:53682/callback"],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, uri) => {
    expect(parseLoopbackRedirectUri(uri)._unsafeUnwrapErr().code).toBe(
      "INVALID_REDIRECT_URI",
    );
  });
});

describe("desktop sign-in flow", () => {
  it("redeems a code for its user with the matching PKCE verifier", async () => {
    const store = memoryStore();
    const code = await startAndIssue(store);

    const redeemed = await redeemDesktopCode(store, { code, codeVerifier: VERIFIER });

    expect(redeemed._unsafeUnwrap()).toEqual({ userId: "user-1" });
  });

  it("rejects a non-loopback redirect before storing anything", async () => {
    const store = memoryStore();

    const started = await startDesktopFlow(store, {
      state: STATE,
      codeChallenge: CHALLENGE,
      redirectUri: "https://evil.example/callback",
    });

    expect(started._unsafeUnwrapErr().code).toBe("INVALID_REDIRECT_URI");
    expect((await takeDesktopFlow(store, STATE))._unsafeUnwrapErr().code).toBe(
      "FLOW_EXPIRED",
    );
  });

  it("does not let a replayed start re-point an in-flight flow", async () => {
    const store = memoryStore();
    const input = { state: STATE, codeChallenge: CHALLENGE, redirectUri: REDIRECT };
    await startDesktopFlow(store, input);

    const replay = await startDesktopFlow(store, {
      ...input,
      redirectUri: "http://127.0.0.1:9999/callback",
    });

    expect(replay._unsafeUnwrapErr().code).toBe("FLOW_ALREADY_STARTED");
    expect((await takeDesktopFlow(store, STATE))._unsafeUnwrap().redirectUri).toBe(
      REDIRECT,
    );
  });

  it("uses a flow only once", async () => {
    const store = memoryStore();
    await startDesktopFlow(store, {
      state: STATE,
      codeChallenge: CHALLENGE,
      redirectUri: REDIRECT,
    });

    await takeDesktopFlow(store, STATE);

    expect((await takeDesktopFlow(store, STATE))._unsafeUnwrapErr().code).toBe(
      "FLOW_EXPIRED",
    );
  });

  it("burns the code on a wrong verifier", async () => {
    const store = memoryStore();
    const code = await startAndIssue(store);

    const wrong = await redeemDesktopCode(store, {
      code,
      codeVerifier: "x".repeat(43),
    });
    const retry = await redeemDesktopCode(store, { code, codeVerifier: VERIFIER });

    expect(wrong._unsafeUnwrapErr().code).toBe("INVALID_CODE_VERIFIER");
    expect(retry._unsafeUnwrapErr().code).toBe("INVALID_CODE");
  });

  it("redeems a code only once", async () => {
    const store = memoryStore();
    const code = await startAndIssue(store);

    await redeemDesktopCode(store, { code, codeVerifier: VERIFIER });
    const again = await redeemDesktopCode(store, { code, codeVerifier: VERIFIER });

    expect(again._unsafeUnwrapErr().code).toBe("INVALID_CODE");
  });

  it("expires an unredeemed code after a minute", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const store = memoryStore();
    const code = await startAndIssue(store);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    const late = await redeemDesktopCode(store, { code, codeVerifier: VERIFIER });

    expect(late._unsafeUnwrapErr().code).toBe("INVALID_CODE");
  });
});

describe("loopbackRedirect", () => {
  it("appends the params to the loopback URI", () => {
    expect(loopbackRedirect(REDIRECT, { code: "abc", state: STATE })).toBe(
      `${REDIRECT}?code=abc&state=${STATE}`,
    );
  });
});

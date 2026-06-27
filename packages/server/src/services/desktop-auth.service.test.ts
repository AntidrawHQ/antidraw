import { describe, expect, it } from "vitest";
import { isLoopbackRedirectUri, sha256Base64Url } from "./desktop-auth.service";

describe("isLoopbackRedirectUri", () => {
  it("accepts loopback /callback URLs", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:5599/callback")).toBe(true);
    expect(isLoopbackRedirectUri("http://localhost:1234/callback")).toBe(true);
    expect(isLoopbackRedirectUri("http://[::1]:8080/callback")).toBe(true);
  });

  it("rejects non-loopback hosts (open-redirect guard)", () => {
    expect(isLoopbackRedirectUri("https://evil.com/callback")).toBe(false);
    expect(isLoopbackRedirectUri("http://169.254.169.254/callback")).toBe(false);
    expect(isLoopbackRedirectUri("http://example.com.127.0.0.1.nip.io/callback")).toBe(false);
  });

  it("rejects https/other schemes and wrong paths", () => {
    expect(isLoopbackRedirectUri("https://127.0.0.1:5599/callback")).toBe(false);
    expect(isLoopbackRedirectUri("http://127.0.0.1:5599/evil")).toBe(false);
    expect(isLoopbackRedirectUri("file:///callback")).toBe(false);
    expect(isLoopbackRedirectUri("not a url")).toBe(false);
  });
});

describe("sha256Base64Url", () => {
  it("is deterministic and url-safe (no +/=, PKCE S256)", async () => {
    const a = await sha256Base64Url("verifier-123");
    const b = await sha256Base64Url("verifier-123");
    expect(a).toBe(b);
    expect(a).not.toMatch(/[+/=]/);
  });

  it("matches a known S256 vector (RFC 7636)", async () => {
    // verifier/challenge pair from RFC 7636 Appendix B.
    expect(await sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("differs for different verifiers", async () => {
    expect(await sha256Base64Url("a")).not.toBe(await sha256Base64Url("b"));
  });
});

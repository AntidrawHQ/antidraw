import { expect, it } from "vitest";
import { verifyCertificate } from "../certificate-verify";

// What the default session's certificate check answers, by host.

const answer = (hostname: string) => {
  let result: number | undefined;
  verifyCertificate({ hostname }, (code) => (result = code));
  return result;
};

it("trusts the app's local servers and leaves every other host to Chromium", () => {
  expect({
    localhost: answer("localhost"),
    "127.0.0.1": answer("127.0.0.1"),
    "api.antidraw.com": answer("api.antidraw.com"),
    "a site on antidraw.app": answer("my-canvas.antidraw.app"),
    "localhost.evil.test": answer("localhost.evil.test"),
  }).toMatchInlineSnapshot(`
    {
      "127.0.0.1": 0,
      "a site on antidraw.app": -3,
      "api.antidraw.com": -3,
      "localhost": 0,
      "localhost.evil.test": -3,
    }
  `);
});

it("never rejects a certificate outright", () => {
  // -2 would fail the handshake before Chromium even checks the certificate.
  for (const host of ["api.antidraw.com", "example.com", "accounts.google.com"]) expect(answer(host)).not.toBe(-2);
});

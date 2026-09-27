import { describe, expect, it } from "vitest";
import { signStorageToken, verifyStorageToken, type StorageTokenPayload } from "./storage-token";

const SECRET = "test-secret-with-enough-entropy-0123456789abcdef";
const NOW = new Date("2026-09-27T12:00:00Z");
const payload: StorageTokenPayload = {
  v: 1,
  op: "put",
  b: "sources",
  k: "u/user-1/source/abc.tar.gz",
  n: 42,
  h: "a".repeat(64),
  ct: "application/gzip",
  exp: NOW.getTime() + 60_000,
};

// Flips one base64url character to another valid one.
const flip = (text: string, at: number) =>
  text.slice(0, at) + (text[at] === "A" ? "B" : "A") + text.slice(at + 1);

describe("storage tokens", () => {
  it("round-trips a payload", async () => {
    const token = await signStorageToken(SECRET, payload);
    expect((await verifyStorageToken(SECRET, token, NOW))._unsafeUnwrap()).toEqual(payload);
  });

  it("refuses a tampered payload", async () => {
    const token = await signStorageToken(SECRET, payload);
    const [body, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ ...payload, k: "u/other/source/x.tar.gz" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    for (const bad of [`${flip(body, 3)}.${signature}`, `${forged}.${signature}`]) {
      const result = await verifyStorageToken(SECRET, bad, NOW);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: 403,
        code: "STORAGE_TOKEN_INVALID",
      });
    }
  });

  it("refuses a tampered or missing signature", async () => {
    const token = await signStorageToken(SECRET, payload);
    const [body, signature] = token.split(".");
    for (const bad of [
      `${body}.${flip(signature, 5)}`,
      `${body}.`,
      body,
      `${token}.x`,
      "",
      "!!.??",
    ]) {
      const result = await verifyStorageToken(SECRET, bad, NOW);
      expect(result._unsafeUnwrapErr().code).toBe("STORAGE_TOKEN_INVALID");
    }
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signStorageToken(`${SECRET}-other`, payload);
    expect((await verifyStorageToken(SECRET, token, NOW))._unsafeUnwrapErr().code).toBe(
      "STORAGE_TOKEN_INVALID",
    );
  });

  it("refuses an expired token with 410", async () => {
    const token = await signStorageToken(SECRET, payload);
    const later = new Date(payload.exp + 1);
    expect((await verifyStorageToken(SECRET, token, later))._unsafeUnwrapErr()).toMatchObject({
      status: 410,
      code: "STORAGE_TOKEN_EXPIRED",
    });
  });
});

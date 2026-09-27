import { env as stubEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Bindings } from "./env";
import {
  blobKey,
  hasAnyS3Credential,
  hexToBase64,
  isWorkerStorageMode,
  makeUrlSigner,
  siteKey,
  sourceKey,
} from "./storage";
import { verifyStorageToken } from "./storage-token";

const NOW = new Date("2026-09-27T12:34:56.789Z");
const now = () => NOW;
const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // sha256("")

const s3Env: Bindings = {
  ...stubEnv,
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_S3_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_S3_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("keys and encodings", () => {
  it("builds the bucket keys", () => {
    expect(sourceKey("u1", SHA)).toBe(`u/u1/source/${SHA}.tar.gz`);
    expect(blobKey("u1", SHA)).toBe(`u/u1/blob/${SHA}`);
    expect(siteKey("acme-x7k2p", "assets/a.js")).toBe("acme-x7k2p/assets/a.js");
  });

  it("hexToBase64 encodes the digest bytes", () => {
    expect(hexToBase64(SHA)).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    expect(hexToBase64("00ff10")).toBe("AP8Q");
  });
});

describe("signer selection", () => {
  const without = (...names: (keyof Bindings)[]) => {
    const copy = { ...s3Env };
    for (const name of names) delete copy[name];
    return copy;
  };

  it("uses S3 when all three credentials are set, whatever STORAGE_MODE says", () => {
    expect(makeUrlSigner(s3Env, now)._unsafeUnwrap().mode).toBe("s3");
    expect(makeUrlSigner({ ...s3Env, STORAGE_MODE: "worker" }, now)._unsafeUnwrap().mode).toBe(
      "s3",
    );
    expect(isWorkerStorageMode({ ...s3Env, STORAGE_MODE: "worker" })).toBe(false);
  });

  it("refuses partial credentials, even with STORAGE_MODE=worker", () => {
    for (const env of [
      without("R2_ACCOUNT_ID"),
      without("R2_S3_SECRET_ACCESS_KEY"),
      { ...without("R2_S3_ACCESS_KEY_ID"), STORAGE_MODE: "worker" },
    ]) {
      expect(hasAnyS3Credential(env)).toBe(true);
      expect(makeUrlSigner(env, now)._unsafeUnwrapErr()).toMatchObject({
        status: 500,
        code: "STORAGE_MISCONFIGURED",
      });
    }
  });

  it("refuses no credentials without STORAGE_MODE=worker", () => {
    expect(makeUrlSigner(stubEnv, now)._unsafeUnwrapErr().code).toBe("STORAGE_MISCONFIGURED");
    expect(makeUrlSigner({ ...stubEnv, STORAGE_MODE: "s3" }, now)._unsafeUnwrapErr().code).toBe(
      "STORAGE_MISCONFIGURED",
    );
  });

  it("uses the worker route with no credentials and STORAGE_MODE=worker", () => {
    const env = { ...stubEnv, STORAGE_MODE: "worker" };
    expect(isWorkerStorageMode(env)).toBe(true);
    expect(makeUrlSigner(env, now)._unsafeUnwrap().mode).toBe("worker");
  });
});

describe("S3 presigned URLs", () => {
  const signer = makeUrlSigner(s3Env, now)._unsafeUnwrap();

  it("presigns a PUT over the size, type, checksum and metadata", async () => {
    const { url, headers } = await signer.uploadUrl({
      bucket: "sources",
      key: sourceKey("u1", SHA),
      sha256: SHA,
      size: 1234,
      contentType: "application/gzip",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe(`https://${s3Env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(parsed.pathname).toBe(`/antidraw-sources/u/u1/source/${SHA}.tar.gz`);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("7200");
    expect(parsed.searchParams.get("X-Amz-Date")).toBe("20260927T123456Z");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Credential")).toBe(
      "AKIDEXAMPLE/20260927/auto/s3/aws4_request",
    );
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;x-amz-checksum-sha256;x-amz-meta-sha256",
    );
    expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(headers).toEqual({
      "content-type": "application/gzip",
      "content-length": "1234",
      "x-amz-checksum-sha256": hexToBase64(SHA),
      "x-amz-meta-sha256": SHA,
    });
  });

  it("signs cache-control for immutable site files, into the sites bucket", async () => {
    const { url, headers } = await signer.uploadUrl({
      bucket: "sites",
      key: "acme-x7k2p/assets/a-AbC12345.js",
      sha256: SHA,
      size: 1,
      contentType: "text/javascript",
      cacheControl: "public, max-age=31536000, immutable",
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/antidraw-sites/acme-x7k2p/assets/a-AbC12345.js");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "cache-control;content-length;content-type;host;x-amz-checksum-sha256;x-amz-meta-sha256",
    );
    expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("percent-encodes each key segment", async () => {
    const { url } = await signer.uploadUrl({
      bucket: "sites",
      key: "acme-x7k2p/a b/ü.png",
      sha256: SHA,
      size: 1,
      contentType: "image/png",
    });
    expect(new URL(url).pathname).toBe("/antidraw-sites/acme-x7k2p/a%20b/%C3%BC.png");
  });

  it("is deterministic for a fixed clock and credentials", async () => {
    const target = {
      bucket: "sources" as const,
      key: blobKey("u1", SHA),
      sha256: SHA,
      size: 5,
      contentType: "application/octet-stream",
    };
    expect((await signer.uploadUrl(target)).url).toBe((await signer.uploadUrl(target)).url);
  });

  it("presigns a 10-minute GET with no signed headers but host", async () => {
    const url = new URL(await signer.downloadUrl({ bucket: "sources", key: blobKey("u1", SHA) }));
    expect(url.pathname).toBe(`/antidraw-sources/u/u1/blob/${SHA}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("worker (dev) URLs", () => {
  const env = { ...stubEnv, STORAGE_MODE: "worker" };
  const signer = makeUrlSigner(env, now)._unsafeUnwrap();

  it("points uploads at /api/storage with a token carrying the checks", async () => {
    const { url, headers } = await signer.uploadUrl({
      bucket: "sites",
      key: "acme-x7k2p/logo.png",
      sha256: SHA,
      size: 0,
      contentType: "image/png",
    });
    expect(url.startsWith("http://localhost:8799/api/storage/")).toBe(true);
    expect(headers).toEqual({ "content-type": "image/png", "content-length": "0" });
    const token = url.slice("http://localhost:8799/api/storage/".length);
    const payload = (await verifyStorageToken(env.BETTER_AUTH_SECRET, token, NOW))._unsafeUnwrap();
    expect(payload).toMatchObject({
      op: "put",
      b: "sites",
      k: "acme-x7k2p/logo.png",
      n: 0,
      h: SHA,
      ct: "image/png",
      exp: NOW.getTime() + 7200 * 1000,
    });
  });

  it("points downloads at /api/storage with a 10-minute get token", async () => {
    const url = await signer.downloadUrl({ bucket: "sources", key: blobKey("u1", SHA) });
    const token = url.split("/").pop()!;
    const payload = (await verifyStorageToken(env.BETTER_AUTH_SECRET, token, NOW))._unsafeUnwrap();
    expect(payload).toMatchObject({ op: "get", b: "sources", exp: NOW.getTime() + 600_000 });
  });
});

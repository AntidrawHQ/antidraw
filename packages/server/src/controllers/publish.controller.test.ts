import { env as stubEnv } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../index";
import type { Bindings } from "../lib/env";
import { signStorageToken } from "../lib/storage-token";
import { memoryBucket, sha256Hex } from "../test/memory-object-store";
import {
  beginRequest,
  harnesses,
  makeTestDeps,
  performUploads,
  WORKSPACE,
} from "../test/publish-harness";
import { authHeader } from "../test/session";

vi.mock("../lib/require-session", async () =>
  (await import("../test/session")).mockRequireSession(),
);

const USER = "user-1";

const setup = () => {
  const harness = harnesses[0][1]();
  const deps = makeTestDeps(harness);
  const app = createApp({ publishDeps: () => deps });
  const call = (
    path: string,
    init: RequestInit & { json?: unknown } = {},
    user: string | null = USER,
  ) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(user ? authHeader(user) : {}),
          ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.headers as Record<string, string>),
        },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      },
      stubEnv,
    );
  return { app, deps, call };
};

describe("publish routes", () => {
  it("answers 401 in the envelope without a session", async () => {
    const { call } = setup();
    for (const [method, path] of [
      ["POST", "/api/publish/sessions"],
      ["GET", `/api/publish/sites?clientWorkspaceId=${WORKSPACE}`],
      ["POST", "/api/remix"],
    ]) {
      const res = await call(path, method === "GET" ? {} : { method, json: {} }, null);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Sign in required" },
      });
    }
  });

  it("begins, completes, reports and patches through the routes", async () => {
    const { call, deps } = setup();
    const begin = await call("/api/publish/sessions", {
      method: "POST",
      json: await beginRequest(),
    });
    expect(begin.status).toBe(200);
    const begun = (await begin.json()) as Awaited<ReturnType<typeof beginRequest>> & {
      publish: { id: string; siteId: string; slug: string };
      uploads: never[];
    };
    expect(begun.publish).toMatchObject({ baseVersion: 0, slug: expect.any(String) });
    expect(begun.uploads).toHaveLength(8);

    performUploads(deps, begun.uploads);
    const complete = await call(`/api/publish/sessions/${begun.publish.id}/complete`, {
      method: "POST",
      json: {},
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({ version: 1, site: { headVersion: 1 } });

    const session = await call(`/api/publish/sessions/${begun.publish.id}`);
    expect(await session.json()).toMatchObject({ status: "completed", resultVersion: 1 });

    const status = await call(`/api/publish/sites?clientWorkspaceId=${WORKSPACE}`);
    expect(await status.json()).toMatchObject({
      site: { siteId: begun.publish.siteId, allowRemix: true },
    });

    const patched = await call(`/api/publish/sites/${begun.publish.siteId}`, {
      method: "PATCH",
      json: { allowRemix: false },
    });
    expect(await patched.json()).toMatchObject({ site: { allowRemix: false } });

    const remix = await call(
      "/api/remix",
      { method: "POST", json: { slug: begun.publish.slug } },
      "user-2",
    );
    expect(remix.status).toBe(403);
    expect(await remix.json()).toMatchObject({ error: { code: "REMIX_DISABLED" } });

    const aborted = await call(`/api/publish/sessions/${begun.publish.id}/abort`, {
      method: "POST",
    });
    expect(await aborted.json()).toEqual({ ok: true });
  });

  it("answers 400 INVALID_REQUEST with zod's issues", async () => {
    const { call } = setup();
    const body = await beginRequest();
    const res = await call("/api/publish/sessions", {
      method: "POST",
      json: { ...body, clientWorkspaceId: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; details: { issues: { path: string[] }[] } };
    };
    expect(json.error.code).toBe("INVALID_REQUEST");
    expect(json.error.details.issues[0].path).toEqual(["clientWorkspaceId"]);

    const badQuery = await call("/api/publish/sites?clientWorkspaceId=nope");
    expect(badQuery.status).toBe(400);
  });

  it("answers 429 when the limiter denies", async () => {
    const { call, deps } = setup();
    deps.limits.publish = false;
    const res = await call("/api/publish/sessions", { method: "POST", json: await beginRequest() });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("answers 404 for another user's session", async () => {
    const { call } = setup();
    const begin = await call("/api/publish/sessions", {
      method: "POST",
      json: await beginRequest(),
    });
    const { publish } = (await begin.json()) as { publish: { id: string } };
    const res = await call(`/api/publish/sessions/${publish.id}`, {}, "user-2");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "PUBLISH_NOT_FOUND" } });
  });

  it("fails closed with 500 STORAGE_MISCONFIGURED on a deploy without storage", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/publish/sessions",
      {
        method: "POST",
        headers: { ...authHeader(USER), "content-type": "application/json" },
        body: "{}",
      },
      stubEnv,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "STORAGE_MISCONFIGURED" } });
  });
});

describe("storage routes", () => {
  const devEnv = (): Bindings & {
    SITES: ReturnType<typeof memoryBucket>;
    SOURCES: ReturnType<typeof memoryBucket>;
  } => ({
    ...stubEnv,
    STORAGE_MODE: "worker",
    SITES: memoryBucket(),
    SOURCES: memoryBucket(),
  });
  const app = createApp();
  const token = (over: Record<string, unknown> = {}) =>
    signStorageToken(stubEnv.BETTER_AUTH_SECRET, {
      v: 1,
      b: "sources",
      k: "u/user-1/blob/x",
      exp: Date.now() + 60_000,
      ...(over.op === "get"
        ? {}
        : { op: "put", n: 5, h: "0".repeat(64), ct: "application/octet-stream" }),
      ...over,
    } as never);

  it("answers 404 unless STORAGE_MODE=worker and no S3 credential is set", async () => {
    const withCreds = { ...devEnv(), R2_S3_ACCESS_KEY_ID: "x" };
    const unset = { ...devEnv(), STORAGE_MODE: undefined };
    for (const env of [withCreds, unset]) {
      for (const method of ["GET", "PUT"]) {
        const res = await app.request(`/api/storage/${await token()}`, { method }, env);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
      }
    }
  });

  it("stores a PUT whose size and sha256 match, and refuses the rest", async () => {
    const env = devEnv();
    const body = new TextEncoder().encode("hello");
    const h = await sha256Hex(body);
    const put = async (t: string, bytes: Uint8Array, length = String(bytes.length)) =>
      app.request(
        `/api/storage/${t}`,
        { method: "PUT", body: bytes, headers: { "content-length": length } },
        env,
      );

    const ok = await put(await token({ h }), body);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(env.SOURCES.objects.get("u/user-1/blob/x")).toMatchObject({ size: 5, sha256: h });

    const wrongBytes = await put(await token({ h }), new TextEncoder().encode("jello"));
    expect(wrongBytes.status).toBe(400);
    expect(await wrongBytes.json()).toMatchObject({ error: { code: "CHECKSUM_MISMATCH" } });

    const wrongSize = await put(await token({ h, n: 6 }), body);
    expect(wrongSize.status).toBe(400);
    expect(await wrongSize.json()).toMatchObject({ error: { code: "SIZE_MISMATCH" } });

    const bad = await put(`${await token({ h })}x`, body);
    expect(bad.status).toBe(403);
    expect(await bad.json()).toMatchObject({ error: { code: "STORAGE_TOKEN_INVALID" } });

    const getToken = await put(await token({ op: "get" }), body);
    expect(getToken.status).toBe(403);

    const expired = await put(await token({ h, exp: Date.now() - 1 }), body);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: { code: "STORAGE_TOKEN_EXPIRED" } });
  });

  it("serves a GET as an opaque download", async () => {
    const env = devEnv();
    await env.SOURCES.put("u/user-1/source/s.tar.gz", "<script>alert(1)</script>");
    const res = await app.request(
      `/api/storage/${await token({ op: "get", k: "u/user-1/source/s.tar.gz" })}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("<script>alert(1)</script>");

    const missing = await app.request(
      `/api/storage/${await token({ op: "get", k: "nope" })}`,
      {},
      env,
    );
    expect(missing.status).toBe(404);
    const putToken = await app.request(`/api/storage/${await token()}`, {}, env);
    expect(putToken.status).toBe(403);
  });
});

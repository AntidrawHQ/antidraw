import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { err } from "neverthrow";
import app, { createApp } from "./index";
import { apiError } from "./lib/errors";
import { respond } from "./lib/respond";
import type { AppEnv } from "./lib/env";

describe("antidraw-server", () => {
  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      service: "antidraw-server",
    });
  });

  it("answers unknown routes with the JSON error envelope", async () => {
    const res = await app.request("/api/nope");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });

  it("answers an uncaught throw with the envelope, leaking nothing", async () => {
    const withBoom = createApp();
    withBoom.get("/boom", () => {
      throw new Error("secret internal detail");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await withBoom.request("/boom");

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("secret internal detail");
    expect(JSON.parse(body)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    // The detail is not lost — it goes to the Worker log, not the client.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("preserves the status of a thrown HTTPException", async () => {
    const withThrow = createApp();
    withThrow.get("/teapot", () => {
      throw new HTTPException(418, { message: "I am a teapot" });
    });

    const res = await withThrow.request("/teapot");

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({
      error: { code: "HTTP_ERROR", message: "I am a teapot" },
    });
  });
});

describe("respond", () => {
  it("serializes an Err to { error: { code, message } } with its status", async () => {
    const one = new Hono<AppEnv>();
    one.get("/", (ctx) => respond(ctx, err(apiError(403, "FORBIDDEN", "Nope"))));

    const res = await one.request("/");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Nope" },
    });
  });
});

import { describe, expect, it } from "vitest";
import app from "./index";

describe("antidraw-server", () => {
  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      service: "antidraw-server",
    });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
  });
});

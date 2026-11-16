import "@/main/api/__tests__/e2e-env"; // must stay the first import: a tmp ANTIDRAW_ROOT
import fs from "node:fs";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ok } from "neverthrow";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { clearMcpPort, loadMcpToken, mcpConfigPath, reclaimMcpPort, saveMcpPort } from "@/main/mcp/config";
import { startMcpHttpServer, startMcpHttpServerPreferring, type RunningMcpServer } from "@/main/mcp/server";
import { EMPTY_MIRROR } from "@/shared/canvas-mirror";
import type { CanvasState, WorkspaceHost } from "@/main/mcp/types";

// The real HTTP server on a free port, as an agent reaches it, with the
// app behind it faked: only the way in is under test here.

const host: WorkspaceHost = {
  listWorkspaces: async () => ok([{ id: "w1", name: "Pricing" }]),
  getWorkspace: async (id) => ok({ id, name: "Pricing" }),
  sourcePath: (id) => `/somewhere/${id}/source`,
  listComponents: async () => ok(["Card"]),
  devServer: () => ({ running: false, logPath: null }),
};
const canvas = { view: () => EMPTY_MIRROR } as unknown as CanvasState;

const token = "t".repeat(43);
let server: RunningMcpServer;

beforeAll(async () => {
  server = (await startMcpHttpServer({ port: 0, token, deps: { host, canvas } }))._unsafeUnwrap();
});
afterAll(() => server.close());

// A raw request, with the headers as given (fetch won't set Host).
const raw = (headers: Record<string, string>, method = "POST") =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/mcp",
        method,
        headers: {
          Host: `127.0.0.1:${server.port}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body: data }));
      },
    );
    req.on("error", reject);
    req.end(method === "POST" ? body : undefined);
  });

describe("the MCP server over HTTP", () => {
  test("an agent with the token lists the tools and calls one", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(11);
    expect(client.getInstructions()).toMatch(/^Antidraw is a design canvas/);
    const result = await client.callTool({ name: "list_workspaces", arguments: {} });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({
      workspaces: [{ id: "w1", name: "Pricing", sourcePath: "/somewhere/w1/source" }],
    });
    await client.close();
  });

  test("the token is required, and must be the right one", async () => {
    expect((await raw({ Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await raw({})).status).toBe(401);
    expect((await raw({ Authorization: `Bearer ${"x".repeat(43)}` })).status).toBe(401);
    expect((await raw({ Authorization: `Bearer ${token}x` })).status).toBe(401);
  });

  test("not from a web page, nor under another name for this machine", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    expect((await raw({ ...auth, Origin: `http://localhost:${server.port}` })).status).toBe(403);
    expect((await raw({ ...auth, Origin: "https://localhost:5173" })).status).toBe(403);
    expect((await raw({ ...auth, Host: `evil.example:${server.port}` })).status).toBe(403);
    expect((await raw({ ...auth, Host: "127.0.0.1:1" })).status).toBe(403);
    expect((await raw({ ...auth, Host: `localhost:${server.port}` })).status).toBe(200);
  });

  test("pull-only: no GET stream", async () => {
    expect((await raw({ Authorization: `Bearer ${token}` }, "GET")).status).toBe(405);
  });

  test("a port that's taken is said, not taken over", async () => {
    const result = await startMcpHttpServer({ port: server.port, token, deps: { host, canvas } });
    expect(result._unsafeUnwrapErr()).toEqual({ inUse: true, message: expect.stringMatching(/already in use/) });
  });

  test("preferring a port that's taken: a free one instead, and it answers", async () => {
    const other = (
      await startMcpHttpServerPreferring({ port: server.port, token, deps: { host, canvas } })
    )._unsafeUnwrap();
    try {
      expect(other.port).not.toBe(server.port);
      const reply = await fetch(`http://127.0.0.1:${other.port}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(reply.status).toBe(200);
    } finally {
      await other.close();
    }
  });

  test("preferring a port that's free: that one", async () => {
    const probe = (await startMcpHttpServer({ port: 0, token, deps: { host, canvas } }))._unsafeUnwrap();
    const free = probe.port;
    await probe.close();
    const at = (await startMcpHttpServerPreferring({ port: free, token, deps: { host, canvas } }))._unsafeUnwrap();
    expect(at.port).toBe(free);
    await at.close();
  });
});

describe("mcp.json", () => {
  const saved = () => JSON.parse(fs.readFileSync(mcpConfigPath(), "utf-8")) as unknown;

  test("a token made once and kept, readable only by the user", () => {
    const first = loadMcpToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fs.statSync(mcpConfigPath()).mode & 0o777).toBe(0o600);
    expect(loadMcpToken()).toBe(first);
    expect(saved()).toEqual({ token: first });

    fs.writeFileSync(mcpConfigPath(), "not json");
    fs.chmodSync(mcpConfigPath(), 0o644);
    const fresh = loadMcpToken();
    expect(fresh).not.toBe(first);
    expect(fs.statSync(mcpConfigPath()).mode & 0o777).toBe(0o600);
  });

  test("the port only while a server listens on it", () => {
    const token = loadMcpToken();
    saveMcpPort(token, 47900);
    expect(saved()).toEqual({ port: 47900, token });
    expect(fs.statSync(mcpConfigPath()).mode & 0o777).toBe(0o600);

    // Another launch wrote its own since: left to it.
    clearMcpPort(47901);
    expect(saved()).toEqual({ port: 47900, token });
    clearMcpPort(47900);
    expect(saved()).toEqual({ token });

    // One left by a launch that didn't quit cleanly goes at the next.
    saveMcpPort(token, 47900);
    expect(loadMcpToken()).toBe(token);
    expect(saved()).toEqual({ token });
  });

  test("a launch still listening puts its port back once another has taken it out", () => {
    const token = loadMcpToken();
    reclaimMcpPort(token, 47900);
    expect(saved()).toEqual({ port: 47900, token });
    // Another launch's port in it: left to that one.
    saveMcpPort(token, 47901);
    reclaimMcpPort(token, 47900);
    expect(saved()).toEqual({ port: 47901, token });
  });
});

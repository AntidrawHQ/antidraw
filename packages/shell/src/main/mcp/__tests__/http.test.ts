import "@/main/api/__tests__/e2e-env"; // must stay the first import: a tmp ANTIDRAW_ROOT
import fs from "node:fs";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ok } from "neverthrow";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadMcpConfig, mcpConfigPath } from "@/main/mcp/config";
import { startMcpHttpServer, type RunningMcpServer } from "@/main/mcp/server";
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
    expect(result._unsafeUnwrapErr()).toMatch(/already in use/);
  });
});

describe("mcp.json", () => {
  test("a token made once and kept, with the port, readable only by the user", () => {
    const first = loadMcpConfig(47821);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fs.statSync(mcpConfigPath()).mode & 0o777).toBe(0o600);
    const again = loadMcpConfig(47900);
    expect(again).toEqual({ port: 47900, token: first.token });
    expect(JSON.parse(fs.readFileSync(mcpConfigPath(), "utf-8"))).toEqual(again);

    fs.writeFileSync(mcpConfigPath(), "not json");
    fs.chmodSync(mcpConfigPath(), 0o644);
    const fresh = loadMcpConfig(47821);
    expect(fresh.token).not.toBe(first.token);
    expect(fs.statSync(mcpConfigPath()).mode & 0o777).toBe(0o600);
  });
});

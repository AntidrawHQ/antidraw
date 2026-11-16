import "@/main/api/__tests__/e2e-env"; // must stay the first import: a tmp ANTIDRAW_ROOT
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ok } from "neverthrow";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { agentName, createBridge, postToApp } from "@/main/mcp/bridge/bridge";
import { createMcpServer, startMcpHttpServer, type McpToolCall, type RunningMcpServer } from "@/main/mcp/server";
import type { ToolCall } from "@/main/mcp/tools";
import { EMPTY_MIRROR, type CanvasMirror } from "@/shared/canvas-mirror";
import type { CanvasState, WorkspaceHost } from "@/main/mcp/types";

// What analytics hears of each tool call: which tool, whether it worked,
// how long it took, and for which agent. Never what it carried.

const host: WorkspaceHost = {
  listWorkspaces: async () => ok([{ id: "w1", name: "Secret Workspace" }]),
  getWorkspace: async (id) => ok({ id, name: "Secret Workspace" }),
  sourcePath: (id) => `/Users/someone/secret/${id}`,
  listComponents: async () => ok(["SecretFrame"]),
  devServer: () => ({ running: false, logPath: null }),
};
let view: () => CanvasMirror = () => EMPTY_MIRROR;
const canvas = { view: () => view() } as unknown as CanvasState;
const deps = { host, canvas };

beforeEach(() => {
  view = () => EMPTY_MIRROR;
});

describe("each tool call is counted", () => {
  const calls: ToolCall[] = [];
  let client: Client;

  beforeAll(async () => {
    const server = createMcpServer(deps, (call) => calls.push(call));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
  });
  beforeEach(() => {
    calls.length = 0;
  });
  afterAll(() => client.close());

  test("by its tool, with whether it worked and how long it took", async () => {
    await client.callTool({ name: "list_workspaces", arguments: {} });
    expect(calls).toEqual([{ tool: "list_workspaces", ok: true, durationMs: expect.any(Number) }]);
    expect(calls[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("one that fails as not ok, with nothing it was given or said", async () => {
    const result = await client.callTool({ name: "focus_component", arguments: { name: "SecretFrame" } });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([{ tool: "focus_component", ok: false, durationMs: expect.any(Number) }]);
    expect(JSON.stringify(calls)).not.toMatch(/Secret|someone|workspace is open/i);
  });

  test("one that throws as not ok, still counted", async () => {
    view = () => {
      throw new Error("Secret Workspace broke");
    };
    const result = await client.callTool({ name: "get_selection", arguments: {} });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([{ tool: "get_selection", ok: false, durationMs: expect.any(Number) }]);
  });

  test("not one the SDK turns away: an unknown tool, or arguments that don't parse", async () => {
    await client.callTool({ name: "no_such_tool", arguments: {} }).catch(() => {});
    await client.callTool({ name: "complete_comment", arguments: { id: "x" } }).catch(() => {});
    expect(calls).toEqual([]);
  });
});

describe("for which agent", () => {
  const calls: McpToolCall[] = [];
  const token = "t".repeat(43);
  let server: RunningMcpServer;

  beforeAll(async () => {
    server = (
      await startMcpHttpServer({ port: 0, token, deps, onToolCall: (call) => calls.push(call) })
    )._unsafeUnwrap();
  });
  beforeEach(() => {
    calls.length = 0;
  });
  afterAll(() => server.close());

  const callOverHttp = async (headers: Record<string, string>) => {
    const client = new Client({ name: "direct", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}`, ...headers } },
      }),
    );
    await client.callTool({ name: "list_workspaces", arguments: {} });
    await client.close();
  };

  test("the one `antidraw mcp` passes calls on for, by its client's name", async () => {
    const bridge = createBridge({ address: () => ({ port: server.port, token }), cache: () => null, post: postToApp });
    const send = (message: object) => bridge(JSON.stringify(message));
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.0" } },
    });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_workspaces", arguments: {} } });
    expect(calls).toEqual([{ tool: "list_workspaces", ok: true, durationMs: expect.any(Number), agent: "claude-code" }]);
  });

  test("none for an agent that posts to the server itself", async () => {
    await callOverHttp({});
    expect(calls.map((c) => c.agent)).toEqual([null]);
  });

  test("a name that isn't a plain identifier is other", async () => {
    await callOverHttp({ "x-antidraw-agent": "my agent/with <stuff>" });
    expect(calls.map((c) => c.agent)).toEqual(["other"]);
  });

  test("agentName keeps plain identifiers only", () => {
    expect(agentName("claude-code")).toBe("claude-code");
    expect(agentName("Visual Studio Code")).toBe("Visual Studio Code");
    expect(agentName("codex_mcp.client-1")).toBe("codex_mcp.client-1");
    expect(agentName("")).toBeNull();
    expect(agentName(undefined)).toBeNull();
    expect(agentName(42)).toBeNull();
    expect(agentName("agent ✨")).toBe("other");
    expect(agentName("/Users/someone/bin/agent")).toBe("other");
    expect(agentName("a".repeat(65))).toBe("other");
  });
});

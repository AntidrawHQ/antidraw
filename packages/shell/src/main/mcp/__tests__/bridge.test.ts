import "@/main/api/__tests__/e2e-env"; // must stay the first import: a tmp ANTIDRAW_ROOT
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ok } from "neverthrow";
import { APP_CLOSED, createBridge, postToApp, type AppAddress, type ToolCache } from "@/main/mcp/bridge/bridge";
import {
  bridgeCommandPath,
  bridgeScript,
  installBridgeCommand,
  toolCachePath,
  writeToolCache,
} from "@/main/mcp/bridge-install";
import { startMcpHttpServer, type RunningMcpServer } from "@/main/mcp/server";
import { EMPTY_MIRROR } from "@/shared/canvas-mirror";
import type { CanvasState, ToolDeps, WorkspaceHost } from "@/main/mcp/types";

// `antidraw mcp` as an agent uses it, a line in and lines out, in front of
// the real HTTP server with the app behind that faked; and the same with
// nothing listening, which is the app closed.

const host: WorkspaceHost = {
  listWorkspaces: async () => ok([{ id: "w1", name: "Pricing" }]),
  getWorkspace: async (id) => ok({ id, name: "Pricing" }),
  sourcePath: (id) => `/somewhere/${id}/source`,
  listComponents: async () => ok(["Card"]),
  devServer: () => ({ running: false, logPath: null }),
};
const deps: ToolDeps = { host, canvas: { view: () => EMPTY_MIRROR } as unknown as CanvasState };

const token = "t".repeat(43);
let server: RunningMcpServer;
let cache: ToolCache;

beforeAll(async () => {
  server = (await startMcpHttpServer({ port: 0, token, deps }))._unsafeUnwrap();
  await writeToolCache(deps);
  cache = JSON.parse(fs.readFileSync(toolCachePath(), "utf-8")) as ToolCache;
});
afterAll(() => server.close());

// A port nothing listens on: the app closed.
const CLOSED: AppAddress = { port: 1, token };

type Answer = {
  id?: number;
  result: { protocolVersion?: string; tools?: unknown[]; content?: { text: string }[]; isError?: boolean };
};

const bridgeTo = (address: () => AppAddress | null, tools: ToolCache | null = cache) => {
  const bridge = createBridge({ address, cache: () => tools, post: postToApp });
  return async (message: object) => (await bridge(JSON.stringify(message))).map((line) => JSON.parse(line) as Answer);
};

const initialize = (id: number, protocolVersion = "2025-06-18") => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: { protocolVersion, capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
});
const listTools = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callTool = (id: number, name: string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: {} },
});

describe("antidraw mcp, with the app open", () => {
  test("an agent connects, lists the tools and calls one, with no token of its own", async () => {
    const send = bridgeTo(() => ({ port: server.port, token }));

    const [connected] = await send(initialize(1));
    expect(connected).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "antidraw" } },
    });
    expect(await send({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual([]);

    const [listed] = await send(listTools(2));
    expect(listed!.result.tools).toHaveLength(11);

    const [called] = await send(callTool(3, "list_workspaces"));
    expect(JSON.parse(called!.result.content![0]!.text)).toEqual({
      workspaces: [{ id: "w1", name: "Pricing", sourcePath: "/somewhere/w1/source" }],
    });
  });

  test("what the app refuses comes back as that request's error", async () => {
    const send = bridgeTo(() => ({ port: server.port, token: "x".repeat(43) }));
    expect(await send(listTools(7))).toEqual([
      { jsonrpc: "2.0", id: 7, error: { code: -32000, message: "Missing or wrong bearer token" } },
    ]);
    expect(await send({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual([]);
  });
});

describe("antidraw mcp, with the app closed", () => {
  test("an agent still connects and sees the tools, as the app would have shown them", async () => {
    const live = bridgeTo(() => ({ port: server.port, token }));
    const closed = bridgeTo(() => CLOSED);

    expect(await closed(initialize(1))).toEqual(await live(initialize(1)));
    expect(await closed(listTools(2))).toEqual(await live(listTools(2)));
    expect(await closed({ jsonrpc: "2.0", id: 3, method: "ping" })).toEqual([{ jsonrpc: "2.0", id: 3, result: {} }]);
    expect(await closed({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual([]);
  });

  test("a version the server doesn't speak is answered with the one it prefers", async () => {
    const [connected] = await bridgeTo(() => CLOSED)(initialize(1, "1999-01-01"));
    expect(connected!.result.protocolVersion).toBe(cache.latestProtocolVersion);
  });

  test("a tool call fails with what to do about it", async () => {
    expect(await bridgeTo(() => CLOSED)(callTool(4, "get_comments"))).toEqual([
      { jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: APP_CLOSED }], isError: true } },
    ]);
  });

  test("anything else is refused", async () => {
    expect(await bridgeTo(() => CLOSED)({ jsonrpc: "2.0", id: 5, method: "resources/list" })).toEqual([
      { jsonrpc: "2.0", id: 5, error: { code: -32601, message: "Method not found: resources/list" } },
    ]);
  });

  test("with no address and no tool list, it says the app was never opened", async () => {
    const send = bridgeTo(() => null, null);
    expect(await send(initialize(1))).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Antidraw isn't open, and hasn't left its tool list: open it once." },
      },
    ]);
  });

  test("once the app opens, the same session's calls go through", async () => {
    let address = CLOSED;
    const send = bridgeTo(() => address);
    await send(initialize(1));
    expect(await send(callTool(2, "list_workspaces"))).toMatchObject([{ result: { isError: true } }]);

    address = { port: server.port, token };
    const [called] = await send(callTool(3, "list_workspaces"));
    expect(called!.result.isError).toBeUndefined();
  });
});

describe("antidraw mcp, the line it's given", () => {
  test("what isn't JSON is a parse error, and a blank line is nothing", async () => {
    const bridge = createBridge({ address: () => CLOSED, cache: () => cache, post: postToApp });
    expect(await bridge("{not json")).toEqual([
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
    ]);
    expect(await bridge("  ")).toEqual([]);
  });
});

describe("what the app leaves for antidraw mcp", () => {
  test("the command, runnable, quoting whatever the paths hold", () => {
    expect(
      bridgeScript({
        executable: "/Applications/Antidraw.app/Contents/MacOS/Antidraw",
        script: "/Users/o'neil/My Apps/mcp-bridge.mjs",
        root: "/Users/o'neil/.antidraw",
      }),
    ).toMatchInlineSnapshot(`
      "#!/bin/sh
      # Antidraw's command for coding agents: \`antidraw mcp\`.
      # Written by the app each time it opens; edits here are lost.
      ANTIDRAW_ROOT='/Users/o'\\''neil/.antidraw' ELECTRON_RUN_AS_NODE=1 exec '/Applications/Antidraw.app/Contents/MacOS/Antidraw' '/Users/o'\\''neil/My Apps/mcp-bridge.mjs' "$@"
      "
    `);

    installBridgeCommand();
    expect(fs.statSync(bridgeCommandPath()).mode & 0o777).toBe(0o755);
    const written = fs.statSync(bridgeCommandPath()).mtimeMs;
    installBridgeCommand();
    expect(fs.statSync(bridgeCommandPath()).mtimeMs).toBe(written);
  });

  test("the tool list, as the server gives it", () => {
    expect(cache.tools).toHaveLength(11);
    expect(cache.serverInfo).toMatchObject({ name: "antidraw" });
    expect(cache.instructions).toMatch(/^Antidraw is a design canvas/);
    expect(cache.protocolVersions).toContain(cache.latestProtocolVersion);
  });
});

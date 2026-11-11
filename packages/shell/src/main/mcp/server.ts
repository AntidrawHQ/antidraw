import http from "node:http";
import type { AddressInfo } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { INSTRUCTIONS } from "./instructions";
import { registerTools } from "./tools";
import type { ToolDeps } from "./types";

// The app's MCP server, for coding agents outside it (Claude Code, Codex,
// Cursor): Streamable HTTP at http://127.0.0.1:<port>/mcp, stateless (each
// POST a server of its own, no session to keep) and pull-only (no GET
// stream: nothing is pushed).

export const createMcpServer = (deps: ToolDeps) => {
  const server = new McpServer({ name: "antidraw", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, deps);
  return server;
};

const sameSecret = (given: string, token: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

const bearer = (header: string | undefined) => /^Bearer (\S+)$/i.exec(header ?? "")?.[1] ?? "";

const refuse = (res: http.ServerResponse, status: number, message: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
};

export type RunningMcpServer = { port: number; close: () => Promise<void> };

// Only from this machine, and not from a web page: workspace previews run
// arbitrary code on localhost, and a page can reach 127.0.0.1. A browser
// always sends an Origin on a cross-origin POST, and a page on a rebound DNS
// name sends its own Host; agents send neither. The token says the caller is
// one the user set up.
export const startMcpHttpServer = ({
  port,
  token,
  deps,
}: {
  port: number;
  token: string;
  deps: ToolDeps;
}): Promise<Result<RunningMcpServer, string>> => {
  const server = http.createServer(async (req, res) => {
    const { port: at } = server.address() as AddressInfo;
    if (req.headers.origin !== undefined) return refuse(res, 403, "Requests from web pages aren't accepted");
    if (req.headers.host !== `127.0.0.1:${at}` && req.headers.host !== `localhost:${at}`)
      return refuse(res, 403, "Unexpected Host");
    if (new URL(req.url ?? "/", `http://127.0.0.1:${at}`).pathname !== "/mcp") return refuse(res, 404, "Not found");
    if (!sameSecret(bearer(req.headers.authorization), token))
      return refuse(res, 401, "Missing or wrong bearer token", { "WWW-Authenticate": "Bearer" });
    if (req.method !== "POST") return refuse(res, 405, "Method not allowed", { Allow: "POST" });

    const mcp = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error("[mcp] request failed:", e);
      if (!res.headersSent) refuse(res, 500, "Internal server error");
    }
  });

  return new Promise((resolve) => {
    server.once("error", (e: NodeJS.ErrnoException) =>
      resolve(err(e.code === "EADDRINUSE" ? `port ${port} is already in use` : e.message)),
    );
    server.listen(port, "127.0.0.1", () =>
      resolve(
        ok({
          port: (server.address() as AddressInfo).port,
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done());
              server.closeAllConnections();
            }),
        }),
      ),
    );
  });
};

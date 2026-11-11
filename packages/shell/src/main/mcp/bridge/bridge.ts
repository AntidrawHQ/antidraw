// What `antidraw mcp` does (./main.ts): an agent talks MCP to it over
// stdio, and it passes each message to the app's HTTP server (../server.ts)
// with the token from <antidrawRoot>/mcp.json. So an agent's config names a
// command, with no URL or token in it; and with the app closed the agent
// still connects and sees the tools, from the list the app left behind
// (../bridge-install.ts), and is told the app isn't open when it calls one.
//
// Run by Electron as plain Node, outside the app: nothing here may import
// the app's modules, only their types.

// What the app writes to <antidrawRoot>/mcp-tools.json on launch.
export type ToolCache = {
  // The protocol versions its server speaks, and the one it prefers.
  protocolVersions: string[];
  latestProtocolVersion: string;
  // Its answer to `initialize`, less the version.
  capabilities: Record<string, unknown>;
  serverInfo: Record<string, unknown>;
  instructions?: string;
  tools: unknown[];
};

export type AppAddress = { port: number; token: string };

export type AppReply = { status: number; contentType: string; text: string };

export type BridgeIo = {
  // Read each time: the app may have been opened, or moved port, since.
  address: () => AppAddress | null;
  cache: () => ToolCache | null;
  // Rejects when nothing answers at the address.
  post: (address: AppAddress, protocolVersion: string | null, body: string) => Promise<AppReply>;
};

type Id = string | number;
type Message = { jsonrpc?: string; id?: Id | null; method?: string; params?: Record<string, unknown> };

export const APP_CLOSED =
  "Antidraw isn't open, so its canvas can't be reached. Ask the user to open Antidraw, then try again.";

const NEVER_OPENED = "Antidraw isn't open, and hasn't left its tool list: open it once.";

const result = (id: Id, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id: Id | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

// The app's answer to `initialize`, as it would give it: the version the
// client asked for when the server speaks it, its own preferred one if not.
const initializeResult = (cache: ToolCache, asked: unknown) => ({
  protocolVersion:
    typeof asked === "string" && cache.protocolVersions.includes(asked) ? asked : cache.latestProtocolVersion,
  capabilities: cache.capabilities,
  serverInfo: cache.serverInfo,
  ...(cache.instructions === undefined ? {} : { instructions: cache.instructions }),
});

// With the app closed: connecting and listing answered from the cache, a
// tool call answered as a failed call (which the model reads), anything
// else refused. Notifications, and replies, have no answer.
const whileClosed = (message: Message, cache: ToolCache | null): unknown[] => {
  const { id, method } = message;
  if (id === undefined || id === null || method === undefined) return [];
  if (method === "ping") return [result(id, {})];
  if (method === "tools/call") return [result(id, { content: [{ type: "text", text: APP_CLOSED }], isError: true })];
  if (method === "initialize")
    return [
      cache ? result(id, initializeResult(cache, message.params?.protocolVersion)) : failure(id, -32000, NEVER_OPENED),
    ];
  if (method === "tools/list") return [cache ? result(id, { tools: cache.tools }) : failure(id, -32000, NEVER_OPENED)];
  return [failure(id, -32601, `Method not found: ${method}`)];
};

// The messages in a reply's body: JSON, one or several, or an event stream
// of them (the app answers in JSON; a stream is the protocol's other form).
const messagesIn = (reply: AppReply): unknown[] => {
  if (!reply.text.trim()) return [];
  if (reply.contentType.includes("text/event-stream"))
    return reply.text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)) as unknown);
  const body = JSON.parse(reply.text) as unknown;
  return Array.isArray(body) ? body : [body];
};

export const createBridge = (io: BridgeIo) => {
  // The version agreed in `initialize`, sent with each later request as
  // HTTP asks. Agreed with the cache when the app was closed then: the
  // app's server agrees to the same.
  let protocolVersion: string | null = null;

  const pass = async (message: Message): Promise<unknown[]> => {
    const address = io.address();
    const reply = address
      ? await io.post(address, protocolVersion, JSON.stringify(message)).catch(() => null)
      : null;
    const answers = reply ? fromApp(message, reply) : whileClosed(message, io.cache());
    if (message.method === "initialize")
      for (const answer of answers) {
        const agreed = (answer as { result?: { protocolVersion?: unknown } }).result?.protocolVersion;
        if (typeof agreed === "string") protocolVersion = agreed;
      }
    return answers;
  };

  // A reply the app refused (its token changed, a version it doesn't
  // speak) names no request: said again as this request's error.
  const fromApp = (message: Message, reply: AppReply): unknown[] => {
    let messages: unknown[];
    try {
      messages = messagesIn(reply);
    } catch {
      messages = [];
    }
    if (reply.status < 400) return messages;
    if (message.id === undefined || message.id === null) return [];
    const refused = (messages[0] as { error?: { code?: number; message?: string } } | undefined)?.error;
    return [failure(message.id, refused?.code ?? -32000, refused?.message ?? `Antidraw answered ${reply.status}`)];
  };

  // One line in, as an agent wrote it; the lines to write back.
  return async (line: string): Promise<string[]> => {
    if (!line.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [JSON.stringify(failure(null, -32700, "Parse error"))];
    }
    const messages = (Array.isArray(parsed) ? parsed : [parsed]) as Message[];
    const answers = await Promise.all(messages.map(pass));
    return answers.flat().map((answer) => JSON.stringify(answer));
  };
};

// The app's server, as ../server.ts takes a request.
export const postToApp: BridgeIo["post"] = async ({ port, token }, protocolVersion, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
    },
    body,
  });
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
};

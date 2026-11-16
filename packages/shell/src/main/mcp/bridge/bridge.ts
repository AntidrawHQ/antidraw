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

// What the bridge learned in `initialize` and says with each later request:
// the protocol version agreed, as HTTP asks; and the agent, the name its
// client gave (clientInfo.name, as "claude-code"), for the app's analytics
// to count calls by. Stateless, the app hears neither otherwise.
export type Session = { protocolVersion: string | null; agent: string | null };

export const AGENT_HEADER = "x-antidraw-agent";

// A client's name as analytics may have it: a plain identifier, or "other"
// for anything else, so nothing free-form is counted, and nothing a header
// can't carry (fetch throws on that) is sent.
export const agentName = (name: unknown): string | null => {
  if (typeof name !== "string" || name === "") return null;
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(name) ? name : "other";
};

export type BridgeIo = {
  // Read each time: the app may have been opened, or moved port, since.
  address: () => AppAddress | null;
  cache: () => ToolCache | null;
  // Rejects when nothing answers at the address within timeoutMs, as fetch
  // does: why is in the error (notReached).
  post: (address: AppAddress, session: Session, body: string, timeoutMs: number) => Promise<AppReply>;
};

// How long the app has to answer. A tool waits on the canvas at most 10s
// (opening a workspace); connecting and listing don't wait on anything.
export type BridgeTimeouts = { toolCallMs: number; otherMs: number };
const TIMEOUTS: BridgeTimeouts = { toolCallMs: 60_000, otherMs: 10_000 };

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

// A request the app didn't answer, said so as the agent's model reads it:
// a tool call as a failed call, anything else as its error.
const unanswered = (message: Message, text: string): unknown[] => {
  const { id, method } = message;
  if (id === undefined || id === null || method === undefined) return [];
  if (method === "tools/call") return [result(id, { content: [{ type: "text", text }], isError: true })];
  return [failure(id, -32000, text)];
};

// Why a post got no answer, from the error fetch gave; null when nothing
// listens there, which is the app closed.
const notReached = (error: unknown, { port }: AppAddress, timeoutMs: number): string | null => {
  const { name, message, cause } = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (cause?.code === "ECONNREFUSED") return null;
  if (name === "TimeoutError")
    return `Antidraw is open but didn't answer within ${timeoutMs / 1000}s, so this may still be running there. Check whether it took effect before trying again; if it keeps happening, ask the user whether Antidraw is busy or stuck.`;
  if (cause?.code === "UND_ERR_SOCKET" || cause?.code === "ECONNRESET" || cause?.code === "EPIPE")
    return `Antidraw dropped the connection before answering (${cause.message ?? cause.code}), most likely because it was quitting. This may or may not have taken effect: check before trying again, and if Antidraw is now closed, ask the user to open it.`;
  if (cause?.message === "bad port")
    return `Antidraw listens on port ${port}, which Node's fetch refuses to connect to. Ask the user to unset ANTIDRAW_MCP_PORT, or set it to another port, and restart Antidraw.`;
  const why = [message, cause?.code, cause?.message].filter(Boolean).join(": ");
  return `Couldn't reach Antidraw at http://127.0.0.1:${port}/mcp (${why || String(error)}).`;
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

export const createBridge = (io: BridgeIo, timeouts: BridgeTimeouts = TIMEOUTS) => {
  // A version agreed with the cache, the app closed at `initialize`, is
  // one the app's server agrees to as well.
  const session: Session = { protocolVersion: null, agent: null };

  const toApp = async (message: Message): Promise<unknown[]> => {
    const address = io.address();
    if (!address) return whileClosed(message, io.cache());
    const timeoutMs = message.method === "tools/call" ? timeouts.toolCallMs : timeouts.otherMs;
    const sent = await io.post(address, session, JSON.stringify(message), timeoutMs).then(
      (reply) => ({ reply }),
      (error: unknown) => ({ error }),
    );
    if ("reply" in sent) return fromApp(message, sent.reply);
    const why = notReached(sent.error, address, timeoutMs);
    if (why === null) return whileClosed(message, io.cache());
    console.error("[antidraw mcp]", why);
    // Connecting and listing still answered from the cache: failing them
    // fails the agent's whole connection, and the model reads neither.
    if (message.method === "initialize" || message.method === "tools/list" || message.method === "ping")
      return whileClosed(message, io.cache());
    return unanswered(message, why);
  };

  const pass = async (message: Message): Promise<unknown[]> => {
    if (message.method === "initialize") {
      session.agent = agentName((message.params?.clientInfo as { name?: unknown } | undefined)?.name);
    }
    const answers = await toApp(message);
    if (message.method === "initialize")
      for (const answer of answers) {
        const agreed = (answer as { result?: { protocolVersion?: unknown } }).result?.protocolVersion;
        if (typeof agreed === "string") session.protocolVersion = agreed;
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
    if (reply.status < 400) {
      // Something answered, but not with this request's answer: said, or
      // the agent would wait on it for good.
      const answered = messages.some((m) => (m as { id?: unknown } | null)?.id === message.id);
      if (answered || message.method === undefined) return messages;
      return unanswered(
        message,
        `What answered at Antidraw's address (HTTP ${reply.status}, ${reply.contentType || "no content type"}) didn't answer this request. Ask the user whether Antidraw is open and its MCP server started.`,
      );
    }
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
export const postToApp: BridgeIo["post"] = async ({ port, token }, { protocolVersion, agent }, body, timeoutMs) => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
      ...(agent ? { [AGENT_HEADER]: agent } : {}),
    },
    body,
  });
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
};

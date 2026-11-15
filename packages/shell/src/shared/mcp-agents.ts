// The coding agents Antidraw can add its MCP server to by writing their
// config itself (main/mcp/setup). Any other agent is set up by hand.
export const MCP_AGENT_IDS = ["claude", "codex", "cursor", "vscode", "opencode", "pi"] as const;

export type McpAgentId = (typeof MCP_AGENT_IDS)[number];

export const isMcpAgentId = (value: unknown): value is McpAgentId =>
  typeof value === "string" && (MCP_AGENT_IDS as readonly string[]).includes(value);

// What the setup UI shows (GET /api/mcp-setup).
export type McpSetup = {
  // `antidraw mcp` as a config names it: the command's absolute path.
  command: string;
  // The same, as typed in a shell: under the home directory it starts with ~.
  shellCommand: string;
  // Whether each agent's config already runs the command.
  agents: Record<McpAgentId, { added: boolean }>;
};

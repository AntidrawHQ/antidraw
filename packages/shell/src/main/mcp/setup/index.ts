import fs from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { MCP_AGENT_IDS, type McpAgentId, type McpSetup } from "@/shared/mcp-agents";
import { bridgeCommandPath } from "../bridge-install";
import {
  addAgentServer,
  agentConfigFile,
  agentInstallLink,
  fromHome,
  hasAgentServer,
  thisMachine,
  type Machine,
} from "./agents";

// The setup UI's side of the MCP server: which coding agents already run
// `antidraw mcp` (../bridge), and adding it to one in a click by writing its
// config (./agents.ts).

export type SetupError = { status: 409 | 500; code: string; message: string };

// The command as typed in a shell: from ~ when it's under the home
// directory, quoted when the shell would read it as more than one word.
export const shellCommand = (bridge: string, machine: Machine = thisMachine()) => {
  const short = fromHome(bridge, machine);
  if (/^[\w@%+=:,./~-]+$/.test(short)) return short;
  return `'${bridge.replaceAll("'", `'\\''`)}'`;
};

export const getMcpSetup = (machine: Machine = thisMachine()): McpSetup => {
  const command = bridgeCommandPath();
  return {
    command,
    shellCommand: shellCommand(command, machine),
    agents: Object.fromEntries(
      MCP_AGENT_IDS.map((id) => [id, { added: hasAgentServer(id, command, machine) }]),
    ) as McpSetup["agents"],
  };
};

export const addToAgent = (id: McpAgentId, machine: Machine = thisMachine()): Result<void, SetupError> => {
  const command = bridgeCommandPath();
  // Put there as the app opens (../index.ts): a config naming a command that isn't would fail in the agent.
  if (!fs.existsSync(command))
    return err({
      status: 500,
      code: "COMMAND_MISSING",
      message: `Antidraw's command isn't at ${fromHome(command, machine)} yet. Restart Antidraw, then try again.`,
    });

  const file = agentConfigFile(id, machine);
  return addAgentServer(id, command, machine).mapErr((reason) => ({
    status: 409 as const,
    code: "CONFIG_NOT_CHANGED",
    message: `${path.basename(file)} wasn't changed: ${reason}.`,
  }));
};

export const getAgentInstallLink = (id: McpAgentId): Result<string, SetupError> => {
  const link = agentInstallLink(id, bridgeCommandPath());
  return link ? ok(link) : err({ status: 409, code: "NO_INSTALL_LINK", message: "This agent has no install link." });
};

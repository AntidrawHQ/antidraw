import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { isMcpAgentId } from "@/shared/mcp-agents";
import { addMcpToAgent, getMcpSetup, openMcpInstallLink } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import type { AgentId } from "./agents";

// Where each agent is in its setup, for the titlebar's button and menu
// (components/McpSetup) and the onboarding page's rows (./TwoWaysRows) alike:
// one store, so a row's state shows up on the button.
//
//   idle       not in the agent's config: the row offers "Add"
//   adding     the app is writing the config
//   waiting    added, or its manual step copied, in this session: the agent
//              picks it up in its next session
//   added      in the agent's config already, as main reads it
//   connected  the agent has connected. Nothing sets it yet: main doesn't
//              record who connects to the MCP server.

export type State = "idle" | "adding" | "added" | "waiting" | "connected";

type AgentStatesStore = {
  // This session's, over what the configs say.
  states: Partial<Record<AgentId, State>>;
  // Why an agent's "Add" or install link didn't work, to say in its row.
  errors: Partial<Record<AgentId, string>>;
  set: (id: AgentId, state: State | undefined) => void;
  fail: (id: AgentId, error: string | undefined) => void;
};

export const useAgentStatesStore = create<AgentStatesStore>((set) => ({
  states: {},
  errors: {},
  set: (id, state) => set((s) => ({ states: { ...s.states, [id]: state } })),
  fail: (id, error) => set((s) => ({ errors: { ...s.errors, [id]: error } })),
}));

// The command agents run and which of them have it, read from their configs
// each time the setup is shown: they change outside the app.
const useMcpSetup = () =>
  useQuery({
    queryKey: queryKeys.mcpSetup,
    queryFn: async () => {
      const result = await getMcpSetup();
      if (result.isErr()) throw new Error(result.error.message);
      return result.value;
    },
    retry: false,
  });

export type Bridge = {
  // `antidraw mcp`'s command as a config names it: its absolute path.
  command: string;
  // The same, as typed in a shell.
  shell: string;
};

// Where the command is unless ANTIDRAW_ROOT moves it: shown until main says.
const DEFAULT_BRIDGE: Bridge = { command: "~/.antidraw/bin/antidraw", shell: "~/.antidraw/bin/antidraw" };

export const useBridge = (): Bridge => {
  const { data } = useMcpSetup();
  return data ? { command: data.command, shell: data.shellCommand } : DEFAULT_BRIDGE;
};

export const useAgentStates = () => {
  const queryClient = useQueryClient();
  const { data } = useMcpSetup();
  const { states, errors, set, fail } = useAgentStatesStore();

  const state = (id: AgentId): State =>
    states[id] ?? (isMcpAgentId(id) && data?.agents[id].added ? "added" : "idle");

  return {
    state,
    error: (id: AgentId) => errors[id],
    // "Add": main writes the server into the agent's config. False when it
    // couldn't, with why in `error`.
    add: async (id: AgentId) => {
      if (!isMcpAgentId(id) || state(id) !== "idle") return true;
      set(id, "adding");
      fail(id, undefined);
      const result = await addMcpToAgent(id);
      if (result.isErr()) {
        set(id, undefined);
        fail(id, result.error.message);
        return false;
      }
      set(id, "waiting");
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpSetup });
      return true;
    },
    // A manual step was copied: the agent is the user's to start.
    started: (id: AgentId) => {
      if (state(id) === "idle") set(id, "waiting");
    },
    // The agent's own install prompt (Cursor, VS Code), opened by main.
    install: async (id: AgentId) => {
      if (!isMcpAgentId(id)) return;
      fail(id, undefined);
      const result = await openMcpInstallLink(id);
      if (result.isErr()) return fail(id, result.error.message);
      if (state(id) === "idle") set(id, "waiting");
    },
  };
};

export type Agents = ReturnType<typeof useAgentStates>;

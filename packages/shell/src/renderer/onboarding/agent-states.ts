import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { isMcpAgentId } from "@/shared/mcp-agents";
import { addMcpToAgent, getMcpSetup, openMcpInstallLink } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import type { AgentId } from "./agents";
import { trackSetup, type SetupSource } from "./setup-analytics";

// Where each agent is in its setup, for the titlebar's popover
// (components/McpSetup) and the onboarding page's rows (./TwoWaysRows) alike.
// Only what the app can know: whether the server is in the agent's config,
// and how its own "Add" went.
//
//   idle    not in the agent's config: the row offers "Add"
//   adding  the app is writing the config
//   added   in the agent's config, as main reads it
//   failed  "Add" left the config as it was; the row says why
//
// Whether the agent has started a session since, or connected, isn't said:
// that's the agent's, and main doesn't record who connects.

export type State = "idle" | "adding" | "added" | "failed";

type AgentStatesStore = {
  // The agents whose "Add" is on its way.
  adding: Partial<Record<AgentId, boolean>>;
  // Why an agent's "Add" didn't work, until it's tried again.
  errors: Partial<Record<AgentId, string>>;
  setAdding: (id: AgentId, adding: boolean) => void;
  fail: (id: AgentId, error: string | undefined) => void;
};

export const useAgentStatesStore = create<AgentStatesStore>((set) => ({
  adding: {},
  errors: {},
  setAdding: (id, adding) => set((s) => ({ adding: { ...s.adding, [id]: adding } })),
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
  const { adding, errors, setAdding, fail } = useAgentStatesStore();

  // What the config says comes before how an earlier try went: an agent
  // added by hand since is added.
  const state = (id: AgentId): State =>
    adding[id] ? "adding" : isMcpAgentId(id) && data?.agents[id].added ? "added" : errors[id] ? "failed" : "idle";

  return {
    state,
    error: (id: AgentId) => (state(id) === "failed" ? errors[id] : undefined),
    // "Add", and trying again: main writes the server into the agent's
    // config, and the configs are read again. False when it couldn't, with
    // why in `error`. Counted by how it went, the error by its code alone.
    add: async (id: AgentId, source: SetupSource) => {
      if (!isMcpAgentId(id) || adding[id]) return true;
      setAdding(id, true);
      fail(id, undefined);
      const result = await addMcpToAgent(id);
      trackSetup("mcp_agent_added", { source, agent: id }, {
        ok: result.isOk(),
        error_code: result.isErr() ? result.error.code : null,
      });
      if (result.isErr()) fail(id, result.error.message);
      else await queryClient.invalidateQueries({ queryKey: queryKeys.mcpSetup });
      setAdding(id, false);
      return result.isOk();
    },
    // The configs, read again: after the user has been somewhere they may
    // have changed one (a terminal, the agent's own install prompt).
    refresh: () => void queryClient.invalidateQueries({ queryKey: queryKeys.mcpSetup }),
  };
};

// Opens the agent's own install prompt (Cursor, VS Code), which main makes
// the link for. Why it couldn't, or null.
export const openInstallPrompt = async (id: AgentId, source: SetupSource) => {
  if (!isMcpAgentId(id)) return null;
  const result = await openMcpInstallLink(id);
  trackSetup("mcp_install_link_opened", { source, agent: id }, {
    ok: result.isOk(),
    error_code: result.isErr() ? result.error.code : null,
  });
  return result.isErr() ? result.error.message : null;
};

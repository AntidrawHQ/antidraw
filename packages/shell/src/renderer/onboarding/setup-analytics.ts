import { createContext, useContext } from "react";
import { track } from "@/renderer/lib/analytics";
import type { AnalyticsProperties, RendererEvent } from "@/shared/analytics";
import type { AgentId } from "./agents";

// The MCP setup's analytics: where it was shown, which agent's row, and what
// was done there. An agent's id and an error's code only: never a config's
// path, the command, or why a config couldn't be changed.

/** Where the MCP card is: the onboarding page, or the titlebar's popover. */
export type SetupSource = "onboarding" | "titlebar";

/** What a copy button copies: the command, a config's JSON, or the prompt for an agent. */
export type Copied = "command" | "config" | "prompt";

// Set by the card (TwoWaysRows' McpRows) and, inside a row, its agent's id.
export const SetupPlace = createContext<{ source: SetupSource; agent: AgentId | null }>({
  source: "onboarding",
  agent: null,
});

export const useSetupPlace = () => useContext(SetupPlace);

export const trackSetup = (
  event: Extract<RendererEvent, `mcp_${string}`>,
  place: { source: SetupSource; agent?: AgentId | null },
  properties: AnalyticsProperties = {},
) => track(event, { source: place.source, ...(place.agent ? { agent: place.agent } : {}), ...properties });

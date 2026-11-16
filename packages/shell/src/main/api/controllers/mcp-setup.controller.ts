import { shell } from "electron";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { MCP_AGENT_IDS } from "@/shared/mcp-agents";
import { addToAgent, getAgentInstallLink, getMcpSetup } from "@/main/mcp/setup";

// Setting up the MCP server in a coding agent, for the setup UI
// (renderer/onboarding). The app key is checked for every /api route, these
// included (index.ts).
export const mcpSetupController = new Hono();

const agentParamSchema = z.object({ agent: z.enum(MCP_AGENT_IDS) });

// The command agents run, and which of them already do.
mcpSetupController.get("/", (ctx) => ctx.json(getMcpSetup()));

// One click: writes the server into the agent's own config.
mcpSetupController.post("/:agent/add", zValidator("param", agentParamSchema), (ctx) => {
  const result = addToAgent(ctx.req.valid("param").agent);

  if (result.isErr()) {
    const { status, code, message } = result.error;
    return ctx.json({ error: { code, message } }, status);
  }

  return ctx.json({ ok: true });
});

// Opens the agent's own install prompt (Cursor, VS Code). The link is made
// here, from the agent's name alone: the page can't have any other opened.
mcpSetupController.post("/:agent/install-link", zValidator("param", agentParamSchema), async (ctx) => {
  const link = getAgentInstallLink(ctx.req.valid("param").agent);

  if (link.isErr()) {
    const { status, code, message } = link.error;
    return ctx.json({ error: { code, message } }, status);
  }

  try {
    await shell.openExternal(link.value);
  } catch {
    return ctx.json({ error: { code: "OPEN_FAILED", message: "Couldn't open the agent. Is it installed?" } }, 500);
  }

  return ctx.json({ ok: true });
});

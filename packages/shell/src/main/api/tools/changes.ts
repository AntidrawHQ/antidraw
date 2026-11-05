import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { listComponents } from "@/main/api/services/component.service";
import {
  CHANGES_MCP_SERVER_NAME,
  REPORT_CHANGES_TOOL_NAME,
  parseReportChangesInput,
  reportChangesShape,
} from "@/shared/utils/changed-components";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

// The card lists only what is on disk, so a name that isn't a component is
// sent back for the agent to correct, rather than shown with a View that
// focuses nothing.
export const reportChanges = async (workspaceId: string, input: unknown): Promise<ToolResult> => {
  const changes = parseReportChangesInput(input);
  if (!changes) return fail("Expected { created: string[], updated: string[] }.");
  const { created, updated } = changes;
  if (created.length === 0 && updated.length === 0)
    return fail("Nothing to report: both lists are empty. Only call this when a component was created or updated.");

  const listed = await listComponents(workspaceId);
  if (listed.isErr()) return fail(listed.error.message);
  const onDisk = new Set(listed.value.map((c) => c.name));
  const missing = [...created, ...updated].filter((n) => !onDisk.has(n));
  if (missing.length)
    return fail(
      `Not components: ${missing.join(", ")}. A name is a file in src/components/user-components without .tsx ` +
        `(e.g. "PricingCard"). Call again with only components that exist.`,
    );

  return { content: [{ type: "text", text: "Shown to the user." }] };
};

export const reportChangesTool = (workspaceId: string) =>
  tool(
    REPORT_CHANGES_TOOL_NAME,
    "Show the user the components this turn created and updated, as a card " +
      "in the chat with a View button that focuses each on the canvas. Call " +
      "it once, as the turn's last step, after every component file is " +
      "written. A component is a .tsx directly in src/components/user-components; " +
      "list it by its file name without .tsx. created: files this turn added. " +
      "updated: existing files this turn changed. Skip it when the turn " +
      "changed no component (a question, an explanation).",
    reportChangesShape,
    (input) => reportChanges(workspaceId, input),
  );

// Tools surface to the model as `mcp__canvas_changes__<tool>`.
export const createChangesMcpServer = (workspaceId: string) =>
  createSdkMcpServer({
    name: CHANGES_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [reportChangesTool(workspaceId)],
  });

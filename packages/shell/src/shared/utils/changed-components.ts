import { z } from "zod";

// The components a turn created and updated, reported by the agent once it
// has written them (mcp__canvas_changes__report_changes). Main validates the
// call against the disk; the renderer draws the persisted tool_use as the
// ChangedComponentsCard. Both read the input through this one schema.
export const CHANGES_MCP_SERVER_NAME = "canvas_changes";
export const REPORT_CHANGES_TOOL_NAME = "report_changes";
// The name the tool_use block carries in the transcript.
export const REPORT_CHANGES_TOOL = `mcp__${CHANGES_MCP_SERVER_NAME}__${REPORT_CHANGES_TOOL_NAME}`;

const names = (what: string) =>
  z
    .array(z.string().trim().min(1))
    .describe(
      `Components this turn ${what}, by name: the file name in src/components/user-components without .tsx (e.g. "PricingCard"). [] if none.`,
    );

export const reportChangesShape = {
  created: names("created"),
  updated: names("updated"),
};

export const reportChangesInputSchema = z.object(reportChangesShape);

export type ReportChangesInput = z.infer<typeof reportChangesInputSchema>;

/**
 * The input, each name once: repeats dropped, and a name in both lists kept
 * as created (new this turn, whatever was edited after). Null when it isn't
 * in the expected shape.
 */
export const parseReportChangesInput = (input: unknown): ReportChangesInput | null => {
  const parsed = reportChangesInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const created = [...new Set(parsed.data.created)];
  const updated = [...new Set(parsed.data.updated)].filter((n) => !created.includes(n));
  return { created, updated };
};

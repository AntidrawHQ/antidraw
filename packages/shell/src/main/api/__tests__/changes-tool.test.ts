import { describe, test, expect, vi, beforeEach } from "vitest";
import { ok, err } from "neverthrow";

vi.mock("@/main/api/services/component.service", () => ({
  listComponents: vi.fn(),
}));

import { listComponents } from "@/main/api/services/component.service";
import { reportChanges } from "@/main/api/tools/changes";
import { parseReportChangesInput, REPORT_CHANGES_TOOL } from "@/shared/utils/changed-components";

const mockList = vi.mocked(listComponents);
const onDisk = (...names: string[]) => mockList.mockResolvedValue(ok(names.map((name) => ({ name }))));

describe("reportChanges", () => {
  beforeEach(() => {
    mockList.mockReset();
    onDisk("PricingPage", "PricingTier", "FaqAccordion");
  });

  test("names on disk are shown", async () => {
    expect(await reportChanges("ws", { created: ["FaqAccordion"], updated: ["PricingPage", "PricingTier"] })).toEqual({
      content: [{ type: "text", text: "Shown to the user." }],
    });
    expect(mockList).toHaveBeenCalledWith("ws");
  });

  test("a name that isn't a component goes back to the agent", async () => {
    const result = await reportChanges("ws", { created: ["FaqAccordion.tsx"], updated: ["Missing", "PricingPage"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^Not components: FaqAccordion\.tsx, Missing\./);
  });

  test("nothing to report is an error, not an empty card", async () => {
    const result = await reportChanges("ws", { created: [], updated: [] });
    expect(result.isError).toBe(true);
    expect(mockList).not.toHaveBeenCalled();
  });

  test("an input in the wrong shape is an error", async () => {
    expect((await reportChanges("ws", { created: "FaqAccordion" })).isError).toBe(true);
  });

  test("a listing that fails is an error", async () => {
    mockList.mockResolvedValue(err({ status: 500, code: "FS_ERROR", message: "Failed to list components" }));
    expect(await reportChanges("ws", { created: ["FaqAccordion"], updated: [] })).toEqual({
      content: [{ type: "text", text: "Failed to list components" }],
      isError: true,
    });
  });
});

describe("parseReportChangesInput", () => {
  test("each name once, created winning over updated", () => {
    expect(parseReportChangesInput({ created: ["A", "A", " B "], updated: ["B", "C", "C"] })).toEqual({
      created: ["A", "B"],
      updated: ["C"],
    });
  });

  test("null for anything else", () => {
    expect(parseReportChangesInput(undefined)).toBeNull();
    expect(parseReportChangesInput({ created: [] })).toBeNull();
    expect(parseReportChangesInput({ created: [""], updated: [] })).toBeNull();
  });

  test("the transcript name is the MCP name", () => {
    expect(REPORT_CHANGES_TOOL).toBe("mcp__canvas_changes__report_changes");
  });
});

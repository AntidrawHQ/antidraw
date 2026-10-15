import { describe, expect, it } from "vitest";
import { isRendererEvent, toAnalyticsProperties } from "../analytics";

describe("isRendererEvent", () => {
  it("knows the renderer's events and nothing else", () => {
    expect(isRendererEvent("frame_copied")).toBe(true);
    expect(isRendererEvent("publish_succeeded")).toBe(false);
    expect(isRendererEvent("toString")).toBe(false);
    expect(isRendererEvent(42)).toBe(false);
  });
});

describe("toAnalyticsProperties", () => {
  it("keeps flat primitives and lists of strings", () => {
    expect(
      toAnalyticsProperties({ tool: "inspect", count: 3, open: false, workspace_id: null, groups: ["fill", "gap"] }),
    ).toEqual({ tool: "inspect", count: 3, open: false, workspace_id: null, groups: ["fill", "gap"] });
  });

  it("drops anything else", () => {
    expect(
      toAnalyticsProperties({
        nested: { text: "a prompt" },
        mixed: ["a", 1],
        nan: Number.NaN,
        fn: () => {},
        missing: undefined,
      }),
    ).toEqual({});
    expect(toAnalyticsProperties(null)).toEqual({});
    expect(toAnalyticsProperties(["a"])).toEqual({});
    expect(toAnalyticsProperties("text")).toEqual({});
  });
});

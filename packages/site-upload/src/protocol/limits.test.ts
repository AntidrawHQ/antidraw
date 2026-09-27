import { describe, expect, it } from "vitest";
import { resolveLimits } from "./limits";

const tryResolve = (partial: Record<string, unknown>) => {
  try {
    return resolveLimits(partial as never);
  } catch (err) {
    return `${(err as Error).name}: ${(err as Error).message}`;
  }
};

describe("resolveLimits", () => {
  it("keeps defaults for undefined, and refuses values that would switch a limit off", () => {
    expect({
      "maxFiles: undefined": tryResolve({ maxFiles: undefined }),
      "maxFiles: 5": tryResolve({ maxFiles: 5 }),
      "maxFiles: 0": tryResolve({ maxFiles: 0 }),
      "maxFileBytes: NaN": tryResolve({ maxFileBytes: Number.NaN }),
      "maxTotalBytes: Infinity": tryResolve({ maxTotalBytes: Number.POSITIVE_INFINITY }),
      "maxPathBytes: 1.5": tryResolve({ maxPathBytes: 1.5 }),
      "maxFiles: '10'": tryResolve({ maxFiles: "10" }),
    }).toMatchInlineSnapshot(`
      {
        "maxFileBytes: NaN": "TypeError: Limit maxFileBytes must be a positive integer, got NaN",
        "maxFiles: '10'": "TypeError: Limit maxFiles must be a positive integer, got "10"",
        "maxFiles: 0": "TypeError: Limit maxFiles must be a positive integer, got 0",
        "maxFiles: 5": {
          "maxFileBytes": 99614720,
          "maxFiles": 5,
          "maxManifestBytes": 2097152,
          "maxPathBytes": 1024,
          "maxTotalBytes": 524288000,
        },
        "maxFiles: undefined": {
          "maxFileBytes": 99614720,
          "maxFiles": 10000,
          "maxManifestBytes": 2097152,
          "maxPathBytes": 1024,
          "maxTotalBytes": 524288000,
        },
        "maxPathBytes: 1.5": "TypeError: Limit maxPathBytes must be a positive integer, got 1.5",
        "maxTotalBytes: Infinity": "TypeError: Limit maxTotalBytes must be a positive integer, got Infinity",
      }
    `);
  });
});

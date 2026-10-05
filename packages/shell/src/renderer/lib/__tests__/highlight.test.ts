import { describe, test, expect } from "vitest";
import { highlight, langForPath, parseNumberedLines } from "../highlight";

describe("langForPath", () => {
  test("extensions highlights knows", () => {
    expect(langForPath("/ws/src/components/user-components/Card.tsx")).toBe("tsx");
    expect(langForPath("scripts/build.py")).toBe("py");
    expect(langForPath("config.YML")).toBe("yml");
    expect(langForPath("package.json")).toBe("json");
  });

  test("files named by convention", () => {
    expect(langForPath("/repo/Dockerfile")).toBe("dockerfile");
    expect(langForPath("Makefile")).toBe("makefile");
  });

  test("unknown or missing extensions: null", () => {
    expect(langForPath("notes.unknownext")).toBeNull();
    expect(langForPath("/usr/bin/env")).toBeNull();
  });
});

describe("highlight", () => {
  test("one token array per line, covering the code exactly", () => {
    const code = "const a = 1;\n\n// done\nexport default a";
    const tokens = highlight(code, "ts")!;
    expect(tokens).toHaveLength(4);
    expect(tokens.map((line) => line.map((t) => t.content).join(""))).toEqual(
      code.split("\n"),
    );
    // A keyword is coloured; something in the file must be.
    expect(tokens.flat().some((t) => t.color)).toBe(true);
  });

  test("a partial input mid-stream still tokenizes", () => {
    const tokens = highlight('echo "unterminated', "bash");
    expect(tokens?.[0]?.map((t) => t.content).join("")).toBe('echo "unterminated');
  });

  test("plain when there is no language or nothing to colour", () => {
    expect(highlight("const a = 1", null)).toBeNull();
    expect(highlight("", "ts")).toBeNull();
  });
});

describe("parseNumberedLines", () => {
  test("splits a Read result into numbers and code", () => {
    expect(parseNumberedLines("1\timport a\n2\t\n3\texport {}")).toEqual({
      numbers: ["1", "2", "3"],
      code: "import a\n\nexport {}",
      rest: "",
    });
  });

  test("older arrow format, and an offset read", () => {
    expect(parseNumberedLines("    41→a\n    42→b")).toEqual({
      numbers: ["41", "42"],
      code: "a\nb",
      rest: "",
    });
  });

  test("stops at the first unnumbered line and returns the remainder", () => {
    const result = parseNumberedLines(
      "1\ta\n2\tb\n\n<system-reminder>\nnote\n</system-reminder>",
    );
    expect(result?.code).toBe("a\nb");
    expect(result?.rest).toBe("<system-reminder>\nnote\n</system-reminder>");
  });

  test("not a numbered listing: null", () => {
    expect(parseNumberedLines("File does not exist.")).toBeNull();
  });
});

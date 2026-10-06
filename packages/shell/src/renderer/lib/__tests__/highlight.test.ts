import { describe, test, expect } from "vitest";
import {
  highlight,
  langForPath,
  parseNumberedLines,
  splitShellCommand,
} from "../highlight";

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

describe("splitShellCommand", () => {
  const colours = (code: string, prefix?: string) =>
    highlight(code, "bash", prefix)!.map((line) => line.map((t) => [t.content, t.color]));

  test("the command after a heredoc in a quoted substitution colours as bash", () => {
    const command = [
      `git commit -m "$(cat <<'EOF'`,
      "feat: don't stop",
      "EOF",
      `)" && git push origin main`,
      "git log --oneline -1",
    ].join("\n");
    const segments = splitShellCommand(command);
    expect(segments).toEqual([
      { code: `git commit -m "$(cat <<'EOF'`, lang: "bash" },
      { code: "feat: don't stop", lang: null },
      {
        code: `EOF\n)" && git push origin main\ngit log --oneline -1`,
        lang: "bash",
        prefix: `"$(cat <<'EOF'`,
      },
    ]);
    // Coloured as the whole command lexed at once colours those lines.
    const tail = segments[2]!;
    expect(colours(tail.code, tail.prefix)).toEqual(colours(command).slice(2));
  });

  test("an interpreter named in a quoted title isn't the reader", () => {
    const segments = splitShellCommand(
      `gh pr create --title "Bump node to 22" --body "$(cat <<'EOF'\n## Summary\nEOF\n)"`,
    );
    expect(segments[1]).toEqual({ code: "## Summary", lang: null });
  });

  test("<< in arithmetic, quotes or a comment opens no heredoc", () => {
    for (const line of ["echo $((1 << i))", `grep -rn "<<EOF" scripts/ | head`, "# then cat <<EOF", "(( x << 2 ))"]) {
      const command = `${line}\ncat > a.json <<'EOF'\n{}\nEOF\nnpm test`;
      expect(splitShellCommand(command).map((s) => s.lang)).toEqual(["bash", "json", "bash"]);
    }
  });

  test("a heredoc in a loop body after arithmetic keeps its language", () => {
    const command = "for i in 0 1; do\n  echo $((1 << i))\ndone\ncat > src/A.tsx <<'EOF'\nconst a = 1\nEOF";
    expect(splitShellCommand(command)).toEqual([
      { code: "for i in 0 1; do\n  echo $((1 << i))\ndone\ncat > src/A.tsx <<'EOF'", lang: "bash" },
      { code: "const a = 1", lang: "tsx" },
      { code: "EOF", lang: "bash", prefix: "cat <<'EOF'" },
    ]);
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

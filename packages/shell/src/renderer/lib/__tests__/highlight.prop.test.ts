import fc from "fast-check";
import { codeToTokens, isSupportedLanguage, LiveTokenizer } from "@pierre/highlights";
import houston from "@pierre/highlights/themes/houston";
import { describe, expect, it } from "vitest";
import {
  highlight,
  LineHighlighter,
  langForPath,
  parseNumberedLines,
  splitShellCommand,
  type CodeSegment,
  type Lang,
} from "../highlight";

// Property tests: fast-check generates inputs, and a failure prints the
// smallest input it could shrink to, plus a seed to replay it.

const LANGS: Lang[] = ["ts", "tsx", "js", "python", "bash", "json", "css", "html", "md", "sql"];

// Code-ish text: the fragments lexers branch on (quotes, comments, template
// and JSX delimiters, escapes), joined with arbitrary unicode and whitespace.
const fragment = fc.oneof(
  fc.constantFrom(
    "const ", "x", " = ", "1", "'", '"', "`", "${", "}", "{", "(", ")", "<div>", "</div>",
    "/*", "*/", "//", "#", "\\", "\t", "  ", "\n", "\n", "\n", "def ", "import ", "$(", "EOF",
    "<<", ";", "=>", "/", "re", "🙂", "é", "\u00a0", "\r", "\r\n", "\u2028",
  ),
  fc.string({ maxLength: 4, unit: "grapheme" }),
);
const code = fc.array(fragment, { maxLength: 60 }).map((parts) => parts.join(""));

const lineText = (tokens: { content: string }[]) => tokens.map((t) => t.content).join("");
const style = (tokens: { content: string; color?: string; fontStyle?: number }[]) =>
  tokens.map((t) => [t.content, t.color, t.fontStyle]);

describe("highlight properties", () => {
  it("gives one token line per text line, covering it exactly", () => {
    fc.assert(
      fc.property(code, fc.constantFrom(...LANGS), (text, lang) => {
        const tokens = highlight(text, lang);
        if (tokens === null) return;
        const lines = text.split("\n");
        expect(tokens).toHaveLength(lines.length);
        // Highlights leaves a CRLF's \r out of the tokens; it draws as nothing.
        const crlf = text.split(/\r?\n/);
        tokens.forEach((line, i) => expect(lineText(line)).toBe(crlf[i]));
      }),
      { numRuns: 500 },
    );
  });

  it("colours a streamed prefix's lines as the full text does, once both settle", () => {
    // Not line by line: the lexer looks ahead, so a line can recolour when a
    // later one arrives (an identifier becomes a parameter once a `=>` follows
    // on the next line). What does hold: feeding the rest of the text gets back exactly
    // the full text's colours, so nothing stale survives the stream.
    fc.assert(
      fc.property(code, fc.nat(), fc.constantFrom(...LANGS), (text, cut, lang) => {
        const prefix = text.slice(0, cut % (text.length + 1));
        const partial = highlight(prefix, lang);
        const full = highlight(text, lang);
        if (!partial || !full) return;
        expect(partial.length).toBeLessThanOrEqual(full.length);
        partial.slice(0, -1).forEach((line, i) =>
          expect(lineText(line)).toBe(lineText(full[i]!)),
        );
        expect(highlight(prefix + text.slice(prefix.length), lang)!.map(style)).toEqual(
          full.map(style),
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe("LineHighlighter properties", () => {
  // A streaming input: the text in chunks, each render seeing one more.
  const chunked = fc
    .tuple(code, fc.array(fc.nat(), { maxLength: 12 }))
    .map(([text, cuts]) => {
      const points = [...new Set(cuts.map((c) => c % (text.length + 1)))].sort((a, b) => a - b);
      return [...points.map((p) => text.slice(0, p)), text];
    });

  // The colours a fresh LiveTokenizer gives each line. It lexes line by line,
  // so where codeToTokens looks ahead across a line end (`f` before a `(` on
  // the next line is a call) it can differ; a stream may show either.
  const fg = codeToTokens("x", { lang: "plain", theme: houston }).fg;
  const liveStyle = (code: string, lang: Lang, prefix: string) => {
    const live = new LiveTokenizer({
      lang,
      theme: houston,
      tokenizeMaxLineLength: 1000,
      code: prefix ? `${prefix}\n${code}` : code,
    });
    const lines = [];
    for (let i = prefix ? 1 : 0; i < live.lineCount; i++) {
      lines.push(
        style(live.getLineTokens(i).tokens.map((t) => ({ ...t, color: t.color === fg ? undefined : t.color }))),
      );
    }
    live.dispose();
    return lines;
  };

  it("colours every line as one of the tokenizers would, at every step of a stream", () => {
    fc.assert(
      fc.property(
        chunked,
        fc.constantFrom(...LANGS),
        fc.constantFrom("", '"$(', "cat <<'EOF'"),
        (snapshots, lang, prefix) => {
          const highlighter = new LineHighlighter();
          for (const snapshot of snapshots) {
            const { lines, tokens } = highlighter.update(snapshot, lang, prefix);
            expect(lines).toEqual(snapshot.split("\n"));
            const whole = highlight(snapshot, lang, prefix);
            expect(tokens === null).toBe(whole === null);
            if (!tokens || !whole) continue;
            const live = snapshot.includes("\r") ? whole.map(style) : liveStyle(snapshot, lang, prefix);
            tokens.forEach((line, i) => expect([style(whole[i]!), live[i]]).toContainEqual(style(line)));
          }
          highlighter.dispose();
        },
      ),
      { numRuns: 500 },
    );
  });

  it("keeps the arrays of lines an append leaves alone", () => {
    fc.assert(
      // A \r sends every update down the full re-highlight, which keeps nothing.
      fc.property(chunked.filter((s) => !s.at(-1)!.includes("\r")), fc.constantFrom(...LANGS), (snapshots, lang) => {
        const highlighter = new LineHighlighter();
        let prev = highlighter.update(snapshots[0]!, lang);
        for (const snapshot of snapshots.slice(1)) {
          const next = highlighter.update(snapshot, lang);
          if (prev.tokens && next.tokens) {
            next.tokens.forEach((line, i) => {
              if (line !== prev.tokens![i] && i < prev.lines.length - 1) {
                // Only a lexer lookahead may replace a settled line's array,
                // and then its colours really changed.
                expect(style(line)).not.toEqual(style(prev.tokens![i]!));
              }
            });
          }
          prev = next;
        }
        highlighter.dispose();
      }),
      { numRuns: 300 },
    );
  });
});

describe("langForPath properties", () => {
  const segment = fc.stringMatching(/^[\w.-]{1,12}$/);
  const path = fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => s.join("/"));

  it("returns a language highlights accepts, or null", () => {
    fc.assert(
      fc.property(path, (p) => {
        const lang = langForPath(p);
        expect(lang === null || isSupportedLanguage(lang)).toBe(true);
      }),
    );
  });

  it("depends only on the file name, in any case", () => {
    fc.assert(
      fc.property(path, segment, (dir, name) => {
        expect(langForPath(`${dir}/${name}`)).toBe(langForPath(name));
        expect(langForPath(name.toUpperCase())).toBe(langForPath(name));
      }),
    );
  });
});

/* ── splitShellCommand ─────────────────────────────────────────────────── */

const linesOf = (segments: CodeSegment[]) =>
  segments.flatMap((s) => s.code.split("\n").map((line) => ({ line, lang: s.lang })));

// A line that opens no heredoc and leaves no quote or substitution open:
// unquoted text in which no `<<` is followed by a delimiter (`<<<`, the
// here-string, is fine), and whole quoted or arithmetic pieces whose `<<word`
// isn't a heredoc either.
const OPENER = /(^|[^<])<<-?\s*['"]?[A-Za-z_]/;
const CLOSED = [
  "'<<EOF'", '"<<EOF"', '"use node"', "$((1 << i))", "(( x <<= n ))", '"$(echo hi)"', "'it''s'", "$(ls)",
];
const shellLine = fc
  .array(
    fc.oneof(
      fc.constantFrom("ls -la", " ", "&&", "|", "$x", "echo", "<", ">", "a.tsx", ";", "\t", "<<< word", "<<", "1 << 2", ...CLOSED),
      fc.string({ maxLength: 3, unit: "grapheme" }).filter((s) => !/['"`\\()#$]/.test(s)),
    ),
    { maxLength: 8 },
  )
  .filter((parts) => !OPENER.test(parts.map((p) => (CLOSED.includes(p) ? "x" : p)).join("")))
  .map((parts) => parts.join("").replace(/\n/g, ""));

// The command opening a heredoc, and the language its body is in.
const OPENERS: [before: string, after: string, lang: Lang | null][] = [
  ["python3 -", "", "python"],
  ["cd /ws/source && python3", "", "python"],
  ["python3 x.py && cat", " > src/A.tsx", "tsx"],
  ["node --input-type=module -", "", "js"],
  ["sqlite3 app.db", "", "sql"],
  ["echo hi; ruby", "", "ruby"],
  ["cat", " > src/components/user-components/Card.tsx", "tsx"],
  ["cat > /tmp/check.mjs", "", "mjs"],
  ["cat", ' > "/tmp/edit-$name.json"', "json"],
  ["tee -a notes.md", "", "md"],
  ["cat >> styles.css", "", "css"],
  ["pbcopy", "", null],
  ["bash", "", "bash"],
  // An interpreter's name only counts as the program.
  ["cat", " > server/node/config.json", "json"],
  ["cat > src/lib/python-runner.ts", "", "ts"],
  ["tee src/config.json > /dev/null", "", "json"],
  ["cat", " 2>&1 > out.md", "md"],
  ['git commit -m "Bump node" && cat > a.css', "", "css"],
  ["cat", " | python3", "python"],
  ["FOO=1 sudo -E python3 -", "", "python"],
  ["uv run python -", "", "python"],
  ["docker exec -i db psql -U app", "", "sql"],
];

type Block =
  | { kind: "shell"; lines: string[] }
  | {
      kind: "heredoc";
      opener: string;
      lang: Lang | null;
      body: string[];
      terminator: string | null;
    };

const heredoc = fc
  .record({
    opener: fc.constantFrom(...OPENERS),
    delimiter: fc.constantFrom("EOF", "PY", "END_1", "X.Y"),
    quote: fc.constantFrom("", "'", '"'),
    dash: fc.boolean(),
    space: fc.boolean(),
    tabs: fc.nat({ max: 2 }),
    body: fc.array(
      fc.oneof(shellLine, fc.constantFrom("EOF", "\tEOF", "PY ", "cat <<EOF", "")),
      { maxLength: 6 },
    ),
    terminated: fc.boolean(),
  })
  .map(({ opener: [before, after, lang], delimiter, quote, dash, space, tabs, body, terminated }): Block => ({
    kind: "heredoc",
    opener: `${before} <<${dash ? "-" : ""}${space ? " " : ""}${quote}${delimiter}${quote}${after}`,
    lang,
    // A line that would close the heredoc isn't body; leading tabs only count with <<-.
    body: body.filter((l) => (dash ? l.replace(/^\t+/, "") : l) !== delimiter),
    terminator: terminated ? `${dash ? "\t".repeat(tabs) : ""}${delimiter}` : null,
  }));

const shellBlock = fc
  .array(shellLine, { minLength: 1, maxLength: 3 })
  .map((lines): Block => ({ kind: "shell", lines }));

// Only the last heredoc can still be streaming in, unterminated.
const blocks = fc
  .array(fc.oneof(shellBlock, heredoc), { minLength: 1, maxLength: 6 })
  .map((bs) =>
    bs.map((b, i) =>
      b.kind === "heredoc" && b.terminator === null && i < bs.length - 1
        ? { ...b, terminator: b.opener.match(/<<-?\s*['"]?([\w.]+)/)![1]! }
        : b,
    ),
  );

const render = (bs: Block[]) =>
  bs
    .flatMap((b) =>
      b.kind === "shell"
        ? b.lines
        : [b.opener, ...b.body, ...(b.terminator === null ? [] : [b.terminator])],
    )
    .join("\n");

// The segments a command should split into, built from its blocks rather
// than by scanning text.
const expected = (bs: Block[]): CodeSegment[] => {
  const out: CodeSegment[] = [];
  let shell: string[] = [];
  const flush = () => {
    if (shell.length) out.push({ code: shell.join("\n"), lang: "bash" });
    shell = [];
  };
  for (const b of bs) {
    if (b.kind === "shell") {
      shell.push(...b.lines);
      continue;
    }
    shell.push(b.opener);
    flush();
    if (b.body.length) out.push({ code: b.body.join("\n"), lang: b.lang });
    if (b.terminator !== null) shell.push(b.terminator);
  }
  flush();
  return out;
};

// Any text at all, weighted toward heredoc syntax.
const anyCommand = fc
  .array(
    fc.oneof(
      fc.constantFrom("\n", "\n", "<<EOF", "<<-'PY'", "<< \"E\"", "EOF", "\tEOF", "PY", "E", "python3 ", "cat > a.tsx ", "&&", ";", "<<<", "'"),
      fc.string({ maxLength: 4, unit: "grapheme" }),
    ),
    { maxLength: 30 },
  )
  .map((parts) => parts.join(""));

describe("splitShellCommand properties", () => {
  it("splits any command into segments that join back to it", () => {
    fc.assert(
      fc.property(anyCommand, (command) => {
        const segments = splitShellCommand(command);
        expect(segments.map((s) => s.code).join("\n")).toBe(command);
      }),
      { numRuns: 1000 },
    );
  });

  it("splits heredocs out in the language of whatever reads them", () => {
    fc.assert(
      fc.property(blocks, (bs) => {
        const segments = splitShellCommand(render(bs)).map(({ code, lang }) => ({ code, lang }));
        expect(segments).toEqual(expected(bs));
      }),
      { numRuns: 1000 },
    );
  });

  it("splits a command cut off mid-stream as the full command, cut off", () => {
    // While Bash input streams, the lines already shown keep their language.
    // Cuts fall on line ends: a half-written opener line can't know its
    // heredoc's language yet.
    fc.assert(
      fc.property(fc.oneof(anyCommand, blocks.map(render)), fc.nat(), (command, n) => {
        const lines = command.split("\n");
        const cut = 1 + (n % lines.length);
        const prefix = lines.slice(0, cut).join("\n");
        expect(linesOf(splitShellCommand(prefix))).toEqual(
          linesOf(splitShellCommand(command)).slice(0, cut),
        );
      }),
      { numRuns: 1000 },
    );
  });
});

/* ── parseNumberedLines ────────────────────────────────────────────────── */

describe("parseNumberedLines properties", () => {
  const fileLine = fc
    .array(
      fc.oneof(fc.string({ maxLength: 4, unit: "grapheme" }), fc.constantFrom("\r", "\u2028", "\t", "12\t")),
      { maxLength: 6 },
    )
    .map((parts) => parts.join("").replace(/\n/g, ""));
  // What the CLI appends after a listing: never a numbered line itself.
  const rest = fc.constantFrom("", "<system-reminder>\nnote\n</system-reminder>", "warning: truncated");

  it("recovers the numbers and file text of any listing", () => {
    fc.assert(
      fc.property(
        fc.array(fileLine, { minLength: 1, maxLength: 20 }),
        fc.nat({ max: 5000 }),
        fc.constantFrom("\t", "→"),
        fc.boolean(),
        rest,
        (file, start, separator, padded, trailer) => {
          const numbers = file.map((_, i) => String(start + i + 1));
          const listing = file
            .map((line, i) => `${padded ? numbers[i]!.padStart(6) : numbers[i]}${separator}${line}`)
            .join("\n");
          const parsed = parseNumberedLines(trailer ? `${listing}\n\n${trailer}` : listing);
          expect(parsed).toEqual({ numbers, code: file.join("\n"), rest: trailer });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("returns one number per code line, or null, for any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (text) => {
        const parsed = parseNumberedLines(text);
        if (parsed) expect(parsed.code.split("\n")).toHaveLength(parsed.numbers.length);
      }),
    );
  });
});

import {
  codeToTokens,
  isSupportedLanguage,
  type Lang,
  type ThemedToken,
} from "@pierre/highlights";
import houston from "@pierre/highlights/themes/houston";

export type { Lang, ThemedToken };

// Past this, a tool body renders as plain text. Tokenizing is cheap (~200
// MiB/s); what costs is a span per token in the DOM, re-reconciled on every
// delta while the input streams.
const MAX_HIGHLIGHT_CHARS = 200_000;

// Files named by convention rather than by extension. A Map, so a file named
// "constructor" or "__proto__" doesn't find a property of Object.prototype.
const LANG_BY_NAME = new Map<string, Lang>([
  ["dockerfile", "dockerfile"],
  ["containerfile", "dockerfile"],
  ["makefile", "makefile"],
  ["gnumakefile", "makefile"],
  ["cmakelists", "cmake"],
]);

/**
 * The language for a file, from its name. Highlights accepts most extensions
 * as aliases (ts, py, yml, md, sh…), so the extension is tried as-is first.
 */
export const langForPath = (filePath: string): Lang | null => {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  const stem = name.replace(/\.txt$/, "");
  const byName = LANG_BY_NAME.get(stem);
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = name.slice(dot + 1);
  return isSupportedLanguage(ext) ? (ext as Lang) : null;
};

/**
 * One token array per line, or null when the code should render plain.
 * Synchronous: highlights compiles its lexers into the bundle, so there is no
 * grammar to load and nothing to await between a delta and its colours.
 * Runs that keep the theme's default colour come back without one, so they
 * inherit the surrounding text colour instead of houston's foreground.
 */
export const highlight = (
  code: string,
  lang: Lang | null,
): ThemedToken[][] | null => {
  if (!lang || !code || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const { tokens, fg } = codeToTokens(code, {
    lang,
    theme: houston,
    tokenizeMaxLineLength: 1000,
  });
  for (const line of tokens) {
    for (const token of line) {
      if (token.color?.toLowerCase() === fg?.toLowerCase()) token.color = undefined;
    }
  }
  return tokens;
};

export type CodeSegment = { code: string; lang: Lang | null };

// `<<EOF`, `<< 'PY'`, `<<-"END"`, but not the `<<<` here-string.
// The delimiter starts with a letter, so a shift like `x << 2` in an inline
// script isn't taken for one.
const HEREDOC = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g;

// Programs that run their stdin, so a heredoc fed to them is in their language.
const INTERPRETERS: [RegExp, Lang][] = [
  [/\bpython[\d.]*\b/, "python"],
  [/\b(node|bun|deno)\b/, "js"],
  [/\b(sqlite3|psql|mysql)\b/, "sql"],
  [/\bruby\b/, "ruby"],
  [/\bperl\b/, "perl"],
  [/\b(bash|sh|zsh)\b/, "bash"],
];

// The language of a heredoc's body, from the command on the line that opens
// it: the interpreter reading it, or the file `cat > x.tsx` / `tee x.tsx`
// writes it to. Only the command around the operator counts, not one chained
// before it with && or ;.
const heredocLang = (line: string, at: number): Lang | null => {
  const start = Math.max(
    line.lastIndexOf("&&", at),
    line.lastIndexOf(";", at),
    line.lastIndexOf("||", at),
  );
  const command = line.slice(start + 1).split(/&&|;|\|\|/)[0] ?? "";
  for (const [re, lang] of INTERPRETERS) if (re.test(command)) return lang;
  const target =
    /\b(?:cat|tee)\b[^>|]*?>{1,2}\s*([^\s<>|;&]+)/.exec(command)?.[1] ??
    /\btee\s+(?:-a\s+)?([^\s<>|;&-][^\s<>|;&]*)/.exec(command)?.[1];
  return target ? langForPath(target.replace(/^["']|["']$/g, "")) : null;
};

/**
 * Splits a shell command into bash and the heredoc bodies inside it, each in
 * its own language: `python3 - <<'EOF'` → python, `cat > a.tsx <<'EOF'` →
 * tsx. On its own, the bash lexer colours a whole script as one string.
 * Segments break at line ends, so joining their code with "\n" gives back the
 * command. A body still streaming in, with no terminator yet, runs to the end.
 */
export const splitShellCommand = (command: string): CodeSegment[] => {
  const segments: CodeSegment[] = [];
  let shell: string[] = [];
  const flushShell = () => {
    if (shell.length) segments.push({ code: shell.join("\n"), lang: "bash" });
    shell = [];
  };
  // Heredocs opened on one line read their bodies in order, after it.
  const pending: { delimiter: string; tabs: boolean; lang: Lang | null }[] = [];
  let body: string[] | null = null;

  for (const line of command.split("\n")) {
    const current = pending[0];
    if (body && current) {
      const bare = current.tabs ? line.replace(/^\t+/, "") : line;
      if (bare !== current.delimiter) {
        body.push(line);
        continue;
      }
      // An empty body has no lines to draw.
      if (body.length) segments.push({ code: body.join("\n"), lang: current.lang });
      pending.shift();
      shell.push(line);
      body = null;
      if (pending.length) {
        flushShell();
        body = [];
      }
      continue;
    }
    shell.push(line);
    for (const m of line.matchAll(HEREDOC)) {
      pending.push({
        delimiter: m[3]!,
        tabs: m[1] === "-",
        lang: heredocLang(line, m.index),
      });
    }
    if (pending.length) {
      flushShell();
      body = [];
    }
  }
  if (body?.length && pending[0]) {
    segments.push({ code: body.join("\n"), lang: pending[0].lang });
  }
  flushShell();
  return segments;
};

// `s`: a line of a CRLF file still ends in \r, which `.` won't match alone.
const NUMBERED_LINE = /^\s*(\d+)(?:\t|→)(.*)$/s;

/**
 * Splits a Read result ("1\tcode", or "1→code" from older CLIs) into its line
 * numbers and the file text. Stops at the first line without a number, such as
 * a system reminder the CLI appends, and hands that back as `rest`.
 */
export const parseNumberedLines = (
  text: string,
): { numbers: string[]; code: string; rest: string } | null => {
  const lines = text.split("\n");
  const numbers: string[] = [];
  const code: string[] = [];
  for (const line of lines) {
    const match = NUMBERED_LINE.exec(line);
    if (!match) break;
    numbers.push(match[1]!);
    code.push(match[2]!);
  }
  if (numbers.length === 0) return null;
  return {
    numbers,
    code: code.join("\n"),
    rest: lines.slice(numbers.length).join("\n").trim(),
  };
};

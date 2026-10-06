import {
  codeToTokens,
  isSupportedLanguage,
  LiveTokenizer,
  type Lang,
  type ThemedToken,
} from "@pierre/highlights";
import houston from "@pierre/highlights/themes/houston";

export type { Lang, ThemedToken };

// Past this, a tool body renders as plain text. Tokenizing is cheap (~200
// MiB/s); what costs is a span per token in the DOM.
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

const OPTIONS = { theme: houston, tokenizeMaxLineLength: 1000 } as const;

// houston's foreground, which a token keeps when nothing colours it.
let foreground: string | undefined | null = null;
const themeForeground = () =>
  (foreground ??= codeToTokens("x", {
    lang: "plain",
    ...OPTIONS,
  }).fg?.toLowerCase());

// Runs that keep the theme's default colour come back without one, so they
// inherit the surrounding text colour instead of houston's foreground.
const inheritForeground = (line: ThemedToken[]): ThemedToken[] => {
  const fg = themeForeground();
  for (const token of line) {
    if (token.color?.toLowerCase() === fg) token.color = undefined;
  }
  return line;
};

const canHighlight = (code: string, lang: Lang | null): lang is Lang =>
  !!lang && !!code && code.length <= MAX_HIGHLIGHT_CHARS;

// A segment's lexer prefix sits on a line of its own before the code.
const withPrefix = (code: string, prefix: string) =>
  prefix ? `${prefix}\n${code}` : code;

/**
 * One token array per line, or null when the code should render plain.
 * Synchronous: highlights compiles its lexers into the bundle, so there is no
 * grammar to load and nothing to await between a delta and its colours.
 * `prefix` is lexed first and its tokens dropped (see CodeSegment).
 */
export const highlight = (
  code: string,
  lang: Lang | null,
  prefix = "",
): ThemedToken[][] | null => {
  if (!canHighlight(code, lang)) return null;
  const { tokens } = codeToTokens(withPrefix(code, prefix), {
    lang,
    ...OPTIONS,
  });
  const lines = prefix ? tokens.slice(1) : tokens;
  lines.forEach(inheritForeground);
  return lines;
};

const sameTokens = (a: ThemedToken[], b: ThemedToken[]) =>
  a.length === b.length &&
  a.every((t, i) => {
    const u = b[i];
    return (
      u !== undefined &&
      t.content === u.content &&
      t.color === u.color &&
      t.fontStyle === u.fontStyle
    );
  });

// A copy of `s` that doesn't share its parent's memory. V8 keeps a slice of a
// string as a view into the whole of it, so a line sliced from one streamed
// snapshot would hold that entire snapshot for as long as the line is drawn.
const detach = (s: string) => (" " + s).slice(1);

export type HighlightedLines = {
  code: string;
  lang: Lang | null;
  prefix: string;
  /** The code's lines, split at "\n". */
  lines: string[];
  /** One token array per line, or null to render the lines plain. */
  tokens: ThemedToken[][] | null;
};

/**
 * Highlights code that grows by appends, as a tool input does while it
 * streams. An append re-lexes from the last line on, in a LiveTokenizer that
 * stops once its lexer state matches the old one, so a delta costs the new
 * text rather than the whole input. Lines it didn't touch keep their arrays,
 * so renders can compare them by identity. Anything other than an append
 * starts over with `highlight`.
 */
export class LineHighlighter {
  #current: HighlightedLines | null = null;
  #live: LiveTokenizer | null = null;

  update(code: string, lang: Lang | null, prefix = ""): HighlightedLines {
    const prev = this.#current;
    if (
      prev &&
      prev.code === code &&
      prev.lang === lang &&
      prev.prefix === prefix
    ) {
      return prev;
    }
    const appended =
      prev &&
      prev.code !== "" &&
      prev.lang === lang &&
      prev.prefix === prefix &&
      code.startsWith(prev.code) &&
      (prev.tokens !== null) === canHighlight(code, lang) &&
      // The live tokenizer breaks lines at a lone \r too; split doesn't.
      !code.includes("\r");
    this.#current = appended
      ? this.#append(prev, code)
      : this.#reset(code, lang, prefix);
    return this.#current;
  }

  /** Releases the live tokenizer's Wasm instance. The lines stay. */
  dispose() {
    this.#live?.dispose();
    this.#live = null;
  }

  #reset(code: string, lang: Lang | null, prefix: string): HighlightedLines {
    this.dispose();
    return {
      code,
      lang,
      prefix,
      lines: code.split("\n"),
      tokens: highlight(code, lang, prefix),
    };
  }

  #append(prev: HighlightedLines, code: string): HighlightedLines {
    const { lang, prefix } = prev;
    // The last line may have grown; every line before it is as it was.
    const keep = prev.lines.length - 1;
    const tailStart = prev.code.length - prev.lines[keep]!.length;
    const lines = prev.lines
      .slice(0, keep)
      .concat(detach(code.slice(tailStart)).split("\n"));
    if (!prev.tokens || !lang)
      return { code, lang, prefix, lines, tokens: null };

    const tokens = prev.tokens.slice(0, keep);
    const offset = prefix ? 1 : 0;
    const lineTokens = (i: number) =>
      inheritForeground(this.#live!.getLineTokens(i + offset).tokens);
    if (this.#live) {
      const last = this.#live.lineCount - 1;
      const end = { line: last, character: this.#live.getLineLength(last) };
      const { lineChanges } = this.#live.applyEdits([
        { range: { start: end, end }, newText: code.slice(prev.code.length) },
      ]);
      // The lexer looks ahead, so an append can recolour a line above.
      for (const change of lineChanges) {
        for (
          let i = change.newStartLine - offset;
          i < Math.min(change.newEndLine - offset, keep);
          i++
        ) {
          if (i >= 0) tokens[i] = lineTokens(i);
        }
      }
    } else {
      // The first append (or the first after an idle dispose) lexes it all
      // once, and keeps the old arrays of lines that came out the same.
      this.#live = new LiveTokenizer({
        lang,
        ...OPTIONS,
        code: withPrefix(code, prefix),
      });
      for (let i = 0; i < keep; i++) {
        const fresh = lineTokens(i);
        if (!sameTokens(fresh, tokens[i]!)) tokens[i] = fresh;
      }
    }
    for (let i = keep; i < lines.length; i++) tokens[i] = lineTokens(i);
    return { code, lang, prefix, lines, tokens };
  }
}

export type CodeSegment = {
  code: string;
  lang: Lang | null;
  /**
   * Bash to lex before `code` and then drop, so a segment that starts partway
   * through the command starts in the lexer state the command is in there:
   * inside the `"$(` of `git commit -m "$(cat <<'EOF'`, after a heredoc's
   * opener so its terminator colours as one.
   */
  prefix?: string;
};

/* ── Shell scanning ──────────────────────────────────────────────────── */

// What a point in a command is inside of, innermost last: quotes, command
// substitutions and subshells, backticks, and arithmetic (with "a(" for a
// paren inside it).
type Frame = "'" | '"' | "$(" | "(" | "`" | "$((" | "a(";

type Word = { text: string; quoted: boolean; op?: boolean };
// A command's pipeline: one list of words per stage.
type Pipeline = Word[][];
// A context commands are read in: the top level, or inside $( ( `.
type CommandContext = { pipeline: Pipeline; word: Word | null };

type ShellState = { frames: Frame[]; contexts: CommandContext[] };
type Opener = { delimiter: string; tabs: boolean; pipeline: Pipeline };

const CODE_FRAMES = new Set<Frame | undefined>([undefined, "$(", "(", "`"]);

// `<<EOF`, `<< 'PY'`, `<<-"END"`. The delimiter starts with a letter, so a
// shift like `x << 2` isn't taken for one.
const HEREDOC = /^<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/;

const newCommand = (): CommandContext => ({ pipeline: [[]], word: null });

/**
 * Reads one line of shell, outside any heredoc body, carrying quotes and
 * substitutions across lines in `state`. Returns the heredocs it opens: a
 * `<<` in a quote, a comment or `$(( ))` arithmetic opens none.
 */
const scanLine = (line: string, state: ShellState): Opener[] => {
  const { frames, contexts } = state;
  const openers: Opener[] = [];
  const context = () => contexts[contexts.length - 1]!;
  const addChar = (ch: string, quoted: boolean) => {
    const c = context();
    c.word ??= { text: "", quoted: false };
    c.word.text += ch;
    if (quoted) c.word.quoted = true;
  };
  const endWord = () => {
    const c = context();
    if (c.word) c.pipeline[c.pipeline.length - 1]!.push(c.word);
    c.word = null;
  };
  const addOp = (op: string) => {
    endWord();
    context().pipeline[context().pipeline.length - 1]!.push({
      text: op,
      quoted: false,
      op: true,
    });
  };
  const endCommand = () => {
    endWord();
    contexts[contexts.length - 1] = newCommand();
  };
  const open = (frame: Frame) => {
    frames.push(frame);
    if (frame === "$(" || frame === "(" || frame === "`")
      contexts.push(newCommand());
  };
  const close = () => {
    const frame = frames.pop();
    if (frame === "$(" || frame === "(" || frame === "`") {
      endWord();
      contexts.pop();
    }
  };

  let i = 0;
  while (i < line.length) {
    const top = frames[frames.length - 1];
    const ch = line[i]!;
    const two = line.slice(i, i + 2);

    if (top === "'") {
      if (ch === "'") close();
      else addChar(ch, true);
      i++;
    } else if (top === '"') {
      if (ch === "\\") {
        addChar(line.slice(i, i + 2), true);
        i += 2;
      } else if (ch === '"') {
        close();
        i++;
      } else if (line.startsWith("$((", i)) {
        open("$((");
        i += 3;
      } else if (two === "$(" || ch === "`") {
        open(ch === "`" ? "`" : "$(");
        i += ch === "`" ? 1 : 2;
      } else {
        addChar(ch, true);
        i++;
      }
    } else if (top === "$((" || top === "a(") {
      if (ch === "'" || ch === '"') open(ch);
      else if (ch === "(") open("a(");
      else if (ch === ")") {
        frames.pop();
        // `))` closes the arithmetic itself.
        if (top === "$((") i++;
      }
      i++;
    } else {
      // A command: top level, or inside $( ( `.
      if (ch === "\\") {
        addChar(line.slice(i + 1, i + 2), false);
        i += 2;
      } else if (ch === "'" || ch === '"') {
        addChar("", true);
        open(ch);
        i++;
      } else if (ch === "#" && context().word === null) {
        break;
      } else if (
        line.startsWith("$((", i) ||
        (two === "((" && context().word === null)
      ) {
        addChar("", false);
        open("$((");
        i += ch === "$" ? 3 : 2;
      } else if (two === "$(") {
        addChar("", false);
        open("$(");
        i += 2;
      } else if (ch === "`") {
        if (top === "`") close();
        else open("`");
        i++;
      } else if (ch === "(") {
        endWord();
        open("(");
        i++;
      } else if (ch === ")") {
        if (top === "$(" || top === "(") close();
        else endWord();
        i++;
      } else if (line.startsWith("<<<", i)) {
        // A here-string, and any run of < after it.
        const op = line.slice(i).match(/^<+/)![0];
        addOp(op);
        i += op.length;
      } else if (two === "<<") {
        const m = HEREDOC.exec(line.slice(i));
        addOp("<<");
        if (m) {
          openers.push({
            delimiter: m[3]!,
            tabs: m[1] === "-",
            pipeline: context().pipeline,
          });
          i += m[0].length;
        } else {
          i += 2;
        }
      } else if (ch === ">" || ch === "<" || two === "&>") {
        const op = line.slice(i).match(/^(&>>?|>[>|&]?|<&?)/)![0];
        addOp(op);
        i += op.length;
      } else if (two === "||" || two === "&&") {
        endCommand();
        i += 2;
      } else if (ch === "|") {
        endWord();
        context().pipeline.push([]);
        i++;
      } else if (ch === ";" || ch === "&") {
        endCommand();
        i++;
      } else if (ch === " " || ch === "\t") {
        endWord();
        i++;
      } else {
        addChar(ch, false);
        i++;
      }
    }
  }
  // A line end ends the command, unless it's escaped or inside a quote.
  if (
    CODE_FRAMES.has(frames[frames.length - 1]) &&
    !/(^|[^\\])(\\\\)*\\$/.test(line)
  ) {
    endCommand();
  }
  return openers;
};

// The text that puts a lexer inside the frames a scan is in.
const framePrefix = (frames: Frame[]) =>
  frames.map((f) => (f === "a(" ? "(" : f)).join("");

// Programs that run their stdin, so a heredoc fed to them is in their language.
const INTERPRETERS: [RegExp, Lang][] = [
  [/^python[\d.]*$/, "python"],
  [/^(node|bun|deno)$/, "js"],
  [/^(sqlite3|psql|mysql)$/, "sql"],
  [/^ruby$/, "ruby"],
  [/^perl$/, "perl"],
  [/^(bash|sh|zsh)$/, "bash"],
];
const interpreterLang = (word: string): Lang | null =>
  INTERPRETERS.find(([re]) => re.test(word.split("/").pop()!))?.[1] ?? null;

// Words before a stage's program: `FOO=1 sudo -E env python3`.
const WRAPPERS = new Set([
  "sudo",
  "env",
  "exec",
  "command",
  "time",
  "nice",
  "nohup",
]);
const FILE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>"]);
const isAssignment = (w: Word) => !w.op && /^[A-Za-z_]\w*=/.test(w.text);

// The language of a heredoc's body, from the pipeline its opener is in: the
// file a `cat > x.tsx` or `tee x.tsx` writes it to, or the program reading it
// (`python3 -`, `cat <<EOF | node`). A word only counts unquoted and as a
// program, so a path or a PR title that mentions `node` doesn't.
const heredocLang = (pipeline: Pipeline): Lang | null => {
  for (const stage of pipeline) {
    let p = 0;
    while (
      p < stage.length &&
      (isAssignment(stage[p]!) ||
        (!stage[p]!.op && WRAPPERS.has(stage[p]!.text)) ||
        (p > 0 && stage[p]!.text.startsWith("-")))
    ) {
      p++;
    }
    const program = stage[p];
    if (!program || program.op) continue;
    const args = stage.slice(p + 1);
    // Whether args[i] is the file a redirect writes (not `2>&1`'s descriptor).
    const target = (i: number) =>
      FILE_REDIRECTS.has(args[i - 1]?.op ? args[i - 1]!.text : "");
    if (program.text === "cat" || program.text === "tee") {
      const file =
        program.text === "cat"
          ? args.find((w, i) => !w.op && target(i))
          : args.find(
              (w, i) => !w.op && !w.text.startsWith("-") && !args[i - 1]?.op,
            );
      if (file) return langForPath(file.text);
      continue;
    }
    const lang = interpreterLang(program.text);
    if (lang) return lang;
    // A runner we don't know (`uv run python -`, `docker exec -i db psql`):
    // the first unquoted argument naming an interpreter.
    for (const [i, w] of args.entries()) {
      if (w.op || w.quoted || target(i)) continue;
      const runs = interpreterLang(w.text);
      if (runs) return runs;
    }
  }
  return null;
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
  const state: ShellState = { frames: [], contexts: [newCommand()] };
  let shell: string[] = [];
  let prefix: string | undefined;
  const flushShell = () => {
    if (shell.length) {
      segments.push(
        prefix
          ? { code: shell.join("\n"), lang: "bash", prefix }
          : { code: shell.join("\n"), lang: "bash" },
      );
    }
    shell = [];
    prefix = undefined;
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
      if (body.length)
        segments.push({ code: body.join("\n"), lang: current.lang });
      pending.shift();
      // The terminator starts the next bash segment, lexed after an opener
      // like its own and inside whatever that opener was in.
      prefix = `${framePrefix(state.frames)}cat <<${current.tabs ? "-" : ""}'${current.delimiter}'`;
      shell.push(line);
      body = null;
      if (pending.length) {
        flushShell();
        body = [];
      }
      continue;
    }
    shell.push(line);
    for (const opener of scanLine(line, state)) {
      pending.push({
        delimiter: opener.delimiter,
        tabs: opener.tabs,
        lang: heredocLang(opener.pipeline),
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

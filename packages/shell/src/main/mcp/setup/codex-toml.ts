import { err, ok, type Result } from "neverthrow";

// Codex keeps its MCP servers in config.toml, one table each:
//
//   [mcp_servers.antidraw]
//   command = "/Users/me/.antidraw/bin/antidraw"
//   args = ["mcp"]
//
// Adding ours is appending that table, which is valid wherever the file
// ends, unless the file already says something about `mcp_servers.antidraw`
// (a second definition is an error that stops Codex reading the file at
// all). So this reads only enough TOML to know that: each line's table and
// key. Anything already there that isn't our table, as we'd write it, is
// left for the user to change.

const SERVER = ["mcp_servers", "antidraw"];

// A dotted key's parts (`a."b.c".d`), or null when it isn't one.
const keyParts = (key: string): string[] | null => {
  const parts: string[] = [];
  let rest = key.trim();
  for (;;) {
    const m = /^(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*/.exec(rest);
    if (!m) return null;
    const part = m[1] !== undefined ? unescaped(m[1]) : (m[2] ?? m[3]!);
    if (part === null) return null;
    parts.push(part);
    rest = rest.slice(m[0].length);
    if (rest === "") return parts;
    if (rest[0] !== ".") return null;
    rest = rest.slice(1).trimStart();
  }
};

const ESCAPES: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", e: "\x1b", '"': '"', "\\": "\\" };
const HEX_WIDTH: Record<string, number> = { x: 2, u: 4, U: 8 };

// A basic string's text, its escapes read as TOML reads them (1.1's \e and
// \xHH included); null when one isn't TOML's.
const unescaped = (basic: string): string | null => {
  let out = "";
  for (let at = 0; at < basic.length; at++) {
    if (basic[at] !== "\\") {
      out += basic[at];
      continue;
    }
    const e = basic[++at] ?? "";
    if (Object.hasOwn(ESCAPES, e)) {
      out += ESCAPES[e];
      continue;
    }
    const width = Object.hasOwn(HEX_WIDTH, e) ? HEX_WIDTH[e]! : 0;
    const digits = basic.slice(at + 1, at + 1 + width);
    if (width === 0 || !/^[0-9A-Fa-f]+$/.test(digits) || digits.length !== width) return null;
    const point = parseInt(digits, 16);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
    out += String.fromCodePoint(point);
    at += width;
  }
  return out;
};

// A line without its comment, and what it leaves open: a multi-line string,
// or the brackets of an array or inline table that goes on.
const scan = (line: string, open: { string: string | null; depth: number }) => {
  let code = "";
  let at = 0;
  while (at < line.length) {
    if (open.string) {
      // To its closing delimiter: escapes skipped in a basic one (\""" is a
      // quote, then two), and up to two quotes before it the string's own.
      const quote = open.string[0]!;
      let end = at;
      while (end < line.length && !line.startsWith(open.string, end)) end += quote === '"' && line[end] === "\\" ? 2 : 1;
      if (end >= line.length) return code;
      at = end + 3;
      while (at < end + 5 && line[at] === quote) at++;
      open.string = null;
      continue;
    }
    const c = line[at]!;
    if (c === "#") break;
    if (line.startsWith('"""', at) || line.startsWith("'''", at)) {
      open.string = line.slice(at, at + 3);
      code += '""';
      at += 3;
      continue;
    }
    if (c === '"' || c === "'") {
      // A one-line string: to its closing quote, escapes skipped in a basic one.
      let end = at + 1;
      while (end < line.length && line[end] !== c) end += c === '"' && line[end] === "\\" ? 2 : 1;
      code += line.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    if (c === "[" || c === "{") open.depth++;
    if (c === "]" || c === "}") open.depth--;
    code += c;
    at++;
  }
  return code;
};

type Reading = {
  // Our table, as far as its own keys go: null when the file has none.
  table: { command: string | null; args: string | null } | null;
  // Why the file can't take our table, or have it compared.
  conflict: string | null;
};

const read = (text: string): Reading => {
  const open = { string: null as string | null, depth: 0 };
  let current: string[] | null = [];
  let table: Reading["table"] = null;
  let conflict: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const continued = open.string !== null || open.depth > 0;
    const code = scan(line, open).trim();
    if (continued || code === "") continue;

    // A line that starts with a bracket is a table's header: a value never does.
    if (code.startsWith("[")) {
      // A header's brackets aren't a value's.
      open.depth = 0;
      const list = code.startsWith("[[");
      const closed = code.endsWith(list ? "]]" : "]");
      // One this can't read names no table: its keys are skipped.
      current = closed ? keyParts(list ? code.slice(2, -2) : code.slice(1, -1)) : null;
      const ours = current?.length === 2 && current[0] === SERVER[0] && current[1] === SERVER[1];
      if (list && current?.[0] === SERVER[0]) conflict = "mcp_servers is written as a list of tables";
      else if (ours && table) conflict = "antidraw is there twice";
      else if (ours) table = { command: null, args: null };
      continue;
    }

    const eq = code.indexOf("=");
    const key = eq === -1 ? null : keyParts(code.slice(0, eq));
    if (!key || !current) continue;
    const path = [...current, ...key];
    const value = code.slice(eq + 1).trim();

    if (path[0] !== SERVER[0]) continue;
    const inOurTable = current.length === 2 && current[1] === SERVER[1];
    if (path.length === 1) conflict = "mcp_servers is written on one line";
    else if (path[1] !== SERVER[1]) continue;
    else if (!inOurTable && current.length < 2) conflict = "antidraw is written without a table of its own";
    else if (inOurTable && key.length === 1 && (key[0] === "command" || key[0] === "args") && table)
      // Only as far as the line goes: a value on several lines won't match ours.
      table[key[0]] = value;
  }

  if (open.string !== null) conflict = "a string in it is never closed";
  return { table, conflict };
};

const isOurArgs = (value: string | null) => value !== null && /^\[\s*(?:"mcp"|'mcp')\s*,?\s*\]$/.test(value);

const isOurCommand = (value: string | null, bridge: string) => {
  if (value === null) return false;
  const basic = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
  const literal = /^'([^']*)'$/.exec(value);
  return (basic ? unescaped(basic[1]!) : (literal?.[1] ?? null)) === bridge;
};

const isOurs = (table: NonNullable<Reading["table"]>, bridge: string) =>
  isOurCommand(table.command, bridge) && isOurArgs(table.args);

// Whether the file already runs `<bridge> mcp` as its antidraw server.
export const codexHasServer = (text: string, bridge: string) => {
  const { table, conflict } = read(text);
  return !conflict && !!table && isOurs(table, bridge);
};

// The file with our table at its end; the file itself when it's there already.
export const addCodexServer = (text: string, bridge: string): Result<string, string> => {
  const { table, conflict } = read(text);
  if (conflict) return err(conflict);
  if (table) {
    if (isOurs(table, bridge)) return ok(text);
    return err("it already has an antidraw server, set up another way");
  }
  const gap = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  // A JSON string is a TOML basic string.
  return ok(`${text}${gap}[mcp_servers.antidraw]\ncommand = ${JSON.stringify(bridge)}\nargs = ["mcp"]\n`);
};

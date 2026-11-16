import { isDeepStrictEqual } from "node:util";
import { err, ok, type Result } from "neverthrow";

// Setting one value in an agent's JSON config without rewriting the file:
// the rest of its text stays as it was, comments and trailing commas (which
// VS Code, Cursor and opencode allow) included. No parser to depend on: this
// reads only as much JSON as it takes to find an object's members, and every
// edit is checked against the same change made to the parsed value, so a
// file it misreads is left alone rather than written wrong.

type ObjectNode = {
  kind: "object";
  start: number;
  // Just past its closing brace.
  end: number;
  members: { key: string; start: number; value: Node }[];
  // Whether a comma follows its last member.
  trailingComma: boolean;
};
type ValueNode = { kind: "value"; start: number; end: number };
type Node = ObjectNode | ValueNode;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Parsed = { root: Node | null; value: Json | undefined };

class Unreadable extends Error {}

const parse = (text: string): Parsed => {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (what: string): never => {
    throw new Unreadable(`${what} at offset ${at}`);
  };

  // Whitespace and comments.
  const skip = () => {
    for (;;) {
      const c = text[at];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") at++;
      else if (c === "/" && text[at + 1] === "/") {
        const end = text.indexOf("\n", at);
        at = end === -1 ? text.length : end;
      } else if (c === "/" && text[at + 1] === "*") {
        const end = text.indexOf("*/", at + 2);
        if (end === -1) fail("Unclosed comment");
        at = end + 2;
      } else return;
    }
  };

  const string = (): string => {
    const start = at++;
    while (at < text.length && text[at] !== '"') {
      if (text[at] === "\n") fail("Unclosed string");
      at += text[at] === "\\" ? 2 : 1;
    }
    if (at >= text.length) fail("Unclosed string");
    at++;
    try {
      return JSON.parse(text.slice(start, at)) as string;
    } catch {
      at = start;
      return fail("Bad string");
    }
  };

  const value = (): { node: Node; value: Json } => {
    skip();
    const start = at;
    const c = text[at];

    if (c === "{") {
      at++;
      const node: ObjectNode = { kind: "object", start, end: start, members: [], trailingComma: false };
      const object: { [key: string]: Json } = {};
      let comma = false;
      for (;;) {
        skip();
        if (text[at] === "}") {
          node.trailingComma = comma;
          break;
        }
        if (text[at] !== '"') fail("Expected a key");
        const keyStart = at;
        const key = string();
        skip();
        if (text[at] !== ":") fail("Expected ':'");
        at++;
        const member = value();
        node.members.push({ key, start: keyStart, value: member.node });
        // As JSON.parse has it: a repeated key's last value wins.
        Object.defineProperty(object, key, { value: member.value, enumerable: true, writable: true, configurable: true });
        skip();
        comma = text[at] === ",";
        if (comma) at++;
        else if (text[at] !== "}") fail("Expected ',' or '}'");
      }
      at++;
      node.end = at;
      return { node, value: object };
    }

    if (c === "[") {
      at++;
      const array: Json[] = [];
      for (;;) {
        skip();
        if (text[at] === "]") break;
        array.push(value().value);
        skip();
        if (text[at] === ",") at++;
        else if (text[at] !== "]") fail("Expected ',' or ']'");
      }
      at++;
      return { node: { kind: "value", start, end: at }, value: array };
    }

    if (c === '"') {
      const parsed = string();
      return { node: { kind: "value", start, end: at }, value: parsed };
    }

    // A number, true, false or null: up to whatever ends it.
    while (at < text.length && !/[\s,\]}/]/.test(text[at]!)) at++;
    try {
      return { node: { kind: "value", start, end: at }, value: JSON.parse(text.slice(start, at)) as Json };
    } catch {
      at = start;
      return fail("Unexpected token");
    }
  };

  skip();
  // Nothing in it, or only comments: a config not written yet.
  if (at >= text.length) return { root: null, value: undefined };
  const root = value();
  skip();
  if (at < text.length) fail("Unexpected text after the value");
  return { root: root.node, value: root.value };
};

// The file's value, or undefined for an empty one.
export const readJsonc = (text: string): Result<Json | undefined, string> => {
  // Plain JSON, as most of these files are (and Claude Code's is megabytes
  // of it), is read the fast way.
  try {
    return ok(JSON.parse(text) as Json);
  } catch {
    // Comments, trailing commas, or nothing at all.
  }
  try {
    return ok(parse(text).value);
  } catch (e) {
    if (e instanceof Unreadable) return err(e.message);
    throw e;
  }
};

export const getIn = (value: Json | undefined, path: readonly string[]): Json | undefined => {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = Object.hasOwn(current, key) ? current[key] : undefined;
  }
  return current;
};

const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// The change, made to the parsed value: what the edited text must read as.
const setInValue = (value: Json | undefined, path: readonly string[], next: Json): Json => {
  const [key, ...rest] = path;
  if (key === undefined) return next;
  const object = isObject(value) ? value : {};
  const copy: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(object))
    Object.defineProperty(copy, k, { value: v, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(copy, key, {
    value: setInValue(Object.hasOwn(object, key) ? object[key] : undefined, rest, next),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
};

const nest = (path: readonly string[], value: Json): Json =>
  path.reduceRight<Json>((inner, key) => ({ [key]: inner }), value);

// The spaces and tabs from `start` on, up to `offset` at most.
const indentFrom = (text: string, start: number, offset: number) => {
  let end = start;
  while (end < offset && (text[end] === " " || text[end] === "\t")) end++;
  return text.slice(start, end);
};

// The whitespace a line starts with.
const lineIndent = (text: string, offset: number) =>
  indentFrom(text, text.lastIndexOf("\n", offset - 1) + 1, offset);

// One level of the file's indentation: its first indented member's. The
// lines' starts are found once: a minified file is one line, and searching
// back to its start for every member took minutes on a large one.
const indentUnit = (text: string, root: Node) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const lineStart = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return starts[lo]!;
  };

  const visit = (node: Node): string | null => {
    if (node.kind !== "object") return null;
    const parent = indentFrom(text, lineStart(node.start), node.start).length;
    for (const member of node.members) {
      const start = lineStart(member.start);
      const indent = indentFrom(text, start, member.start);
      const onOwnLine = start + indent.length === member.start;
      if (onOwnLine && indent.length > parent) return indent.slice(parent);
      const deeper = visit(member.value);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  return visit(root) ?? "  ";
};

// A value as the file would write it, its later lines indented to sit at `indent`.
const format = (value: Json, unit: string, indent: string) =>
  JSON.stringify(value, null, unit).replaceAll("\n", `\n${indent}`);

/**
 * `text` with the value at `path` set to `value`, objects on the way made as
 * needed. Fails, changing nothing, when the text isn't JSON (with comments),
 * when something on the path isn't an object, or when the edit doesn't read
 * back as exactly that change.
 */
export const setInJsonc = (text: string, path: readonly string[], value: Json): Result<string, string> => {
  let parsed: Parsed;
  try {
    parsed = parse(text);
  } catch (e) {
    if (e instanceof Unreadable) return err(`it isn't valid JSON (${e.message})`);
    throw e;
  }

  const edited = edit(text, parsed.root, path, value);
  if (edited.isErr()) return edited;

  const expected = setInValue(parsed.value, path, value);
  const reread = readJsonc(edited.value);
  if (reread.isErr() || !isDeepStrictEqual(reread.value, expected)) return err("the change didn't read back as written");
  return edited;
};

const edit = (text: string, root: Node | null, path: readonly string[], value: Json): Result<string, string> => {
  if (root === null) {
    // Whatever comments it holds stay above the new value.
    const kept = text.trimEnd();
    return ok(`${kept}${kept ? "\n" : ""}${JSON.stringify(nest(path, value), null, 2)}\n`);
  }

  const unit = indentUnit(text, root);
  let node: Node = root;
  for (const [depth, key] of path.entries()) {
    if (node.kind !== "object") return err(`${path.slice(0, depth).join(".") || "the file"} isn't an object`);
    // A repeated key's last member is the one read.
    const member = node.members.filter((m) => m.key === key).at(-1);
    const rest = path.slice(depth + 1);

    if (!member) return ok(insert(text, node, key, nest(rest, value), unit));
    if (rest.length === 0) {
      const indent = lineIndent(text, member.start);
      return ok(text.slice(0, member.value.start) + format(value, unit, indent) + text.slice(member.value.end));
    }
    node = member.value;
  }
  return err("the path is empty");
};

// A new member, after the object's last.
const insert = (text: string, object: ObjectNode, key: string, value: Json, unit: string) => {
  const last = object.members.at(-1);
  const close = object.end - 1;
  const closeIndent = lineIndent(text, close);
  const multiline = text.slice(object.start, object.end).includes("\n");

  if (last) {
    const onOwnLine = text.slice(text.lastIndexOf("\n", last.start - 1) + 1, last.start).trim() === "";
    // On one line, it stays on one line.
    if (!multiline || !onOwnLine) {
      const member = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
      return `${text.slice(0, last.value.end)}, ${member}${text.slice(last.value.end)}`;
    }
    // On a line of its own after everything in the object, so a comment
    // stays with the member it's beside. The last member gets the comma it
    // lacks; a trailing comma already there is kept as the file's style.
    const indent = lineIndent(text, last.start);
    const trailingComma = object.trailingComma;
    const contentEnd = object.start + text.slice(object.start, close).trimEnd().length;
    const member = `${JSON.stringify(key)}: ${format(value, unit, indent)}${trailingComma ? "," : ""}`;
    return (
      text.slice(0, last.value.end) +
      (trailingComma ? "" : ",") +
      text.slice(last.value.end, contentEnd) +
      `\n${indent}${member}` +
      text.slice(contentEnd)
    );
  }

  // An empty object: the member goes on a line of its own before the brace.
  const indent = closeIndent + unit;
  const member = `${JSON.stringify(key)}: ${format(value, unit, indent)}`;
  const inside = text.slice(object.start + 1, close).trimEnd();
  return `${text.slice(0, object.start + 1)}${inside}\n${indent}${member}\n${closeIndent}${text.slice(close)}`;
};

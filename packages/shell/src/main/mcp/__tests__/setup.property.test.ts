import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import * as jsonc from "jsonc-parser";
import * as toml from "smol-toml";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { addAgentServer, agentConfigFile, hasAgentServer, type Machine } from "../setup/agents";
import { addCodexServer, codexHasServer } from "../setup/codex-toml";
import { readJsonc, setInJsonc, type Json } from "../setup/jsonc";

// "Add" edits a file its owner wrote, so it's checked against configs written
// every way the formats allow, read by parsers: jsonc-parser (VS Code's) for
// JSON with comments, which isn't the app's own (the app checks each JSON
// edit with its own parser; this checks that parser), and smol-toml for
// Codex's TOML, which the app reads it with too (this checks what the app
// appends, and what it refuses).
//
// For both: an edit reads back, by the other parser, as exactly the change;
// it's refused only when the file can't take it; and nothing else in the file
// changes. Adding twice is adding once.

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// JSON with comments

// What can go between two tokens: whitespace, and comments holding what a
// careless reader would take for code (commas, braces, a commented-out member).
const GAPS = [
  "",
  " ",
  "\n",
  "\n  ",
  "\n\t\t",
  "\r\n    ",
  " // a note\n",
  " // a, b, }\n",
  "/* x */",
  " /* a, b: } */ ",
  '\n  // "k": [1, 2],\n  ',
  "\n/*\n , \n*/\n",
];
const gap = fc.constantFrom(...GAPS);

// Text that looks like syntax: comment openers, braces, quotes, escapes.
const CHARS = ["a", "Z", " ", "/", "*", "{", "}", "[", "]", ",", ":", '"', "\\", "\n", "\t", "é", "😀", "#"];
const chars = fc.array(fc.constantFrom(...CHARS), { maxLength: 8 }).map((cs) => cs.join(""));
const KEYS = ["servers", "mcpServers", "mcp", "antidraw", "a", "b"];
const jsonKey = fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...KEYS) }, { weight: 1, arbitrary: chars });

const scalar = fc.oneof(
  chars.map((s) => JSON.stringify(s)),
  fc.integer().map(String),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => JSON.stringify(n)),
  fc.constantFrom("true", "false", "null", "1E3", "1.50", "-12e-1"),
);

// A value as text, formatted any way JSON with comments allows; keys in an
// object are distinct.
const { value: jsonText, object: objectText } = fc.letrec<{ value: string; array: string; object: string }>((tie) => ({
  value: fc.oneof({ depthSize: "small", withCrossShrink: true }, scalar, tie("array"), tie("object")),
  array: fc
    .record({ items: fc.array(fc.tuple(gap, tie("value"), gap), { maxLength: 3 }), trailing: fc.boolean(), end: gap })
    .map(
      ({ items, trailing, end }) =>
        `[${items.map(([a, v, b], i) => a + v + b + (i < items.length - 1 || trailing ? "," : "")).join("")}${end}]`,
    ),
  object: fc
    .record({
      members: fc.uniqueArray(
        fc.record({ key: jsonKey, before: gap, colon: gap, after: gap, value: tie("value"), end: gap }),
        { selector: (m) => m.key, maxLength: 4 },
      ),
      trailing: fc.boolean(),
      end: gap,
    })
    .map(
      ({ members, trailing, end }) =>
        `{${members
          .map(
            (m, i) =>
              m.before +
              JSON.stringify(m.key) +
              m.colon +
              ":" +
              m.after +
              m.value +
              m.end +
              (i < members.length - 1 || trailing ? "," : ""),
          )
          .join("")}${end}}`,
    ),
}));

// A config file: mostly an object, sometimes nothing yet or not an object;
// maybe a BOM, and a comment after the value with no newline to end it.
const jsoncFile = fc
  .record({
    bom: fc.boolean(),
    lead: gap,
    root: fc.oneof(
      { weight: 8, arbitrary: objectText },
      { weight: 1, arbitrary: jsonText },
      { weight: 1, arbitrary: fc.constant("") },
    ),
    tail: gap,
    last: fc.constantFrom("", "\n", " // end"),
  })
  .map(({ bom, lead, root, tail, last }) => {
    const plain = lead + root + tail + last;
    return { text: (bom ? "\ufeff" : "") + plain, plain, bom };
  });

const JSON_PATHS = [["servers", "antidraw"], ["mcpServers", "antidraw"], ["mcp", "servers", "antidraw"], ["mcp", "antidraw"], ["antidraw"]];
const jsonPath = fc.constantFrom(...JSON_PATHS);
const entry = fc.oneof(
  // As main makes it: a plain object.
  fc.record({ command: chars, args: fc.array(chars, { maxLength: 2 }) }, { noNullPrototype: true }),
  jsonText.map((t) => jsonc.parse(t) as Json),
);

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true };

// The value by jsonc-parser; the text is one it reads without an error.
const reference = (plain: string): unknown => {
  const errors: jsonc.ParseError[] = [];
  const value: unknown = jsonc.parse(plain, errors, PARSE_OPTIONS);
  expect(errors).toEqual([]);
  return value;
};
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const setIn = (value: unknown, [key, ...rest]: string[], next: unknown): unknown =>
  key === undefined ? next : { ...(isObject(value) ? value : {}), [key]: setIn(isObject(value) ? value[key] : undefined, rest, next) };

// Whether the path can be set: nothing on it is there but objects.
const settable = (value: unknown, [key, ...rest]: string[]): boolean =>
  value === undefined || (isObject(value) && (rest.length === 0 || settable(value[key!], rest)));

const comments = (text: string) => {
  const found: string[] = [];
  jsonc.visit(text, { onComment: (offset, length) => void found.push(text.slice(offset, length + offset)) }, PARSE_OPTIONS);
  return found;
};

// Whether every character of `part` is in `whole`, in order.
const within = (part: string, whole: string) => {
  let at = 0;
  for (let i = 0; i < whole.length && at < part.length; i++) if (whole[i] === part[at]) at++;
  return at === part.length;
};
const squeezed = (text: string) => text.replace(/\s+/g, "");

describe("a JSON config with comments", () => {
  test("is read as jsonc-parser reads it", () => {
    fc.assert(
      fc.property(jsoncFile, ({ text, plain }) => {
        expect(readJsonc(text)._unsafeUnwrap()).toEqual(reference(plain));
      }),
      { numRuns: 1000 },
    );
  });

  test("takes the value wherever the path can be set, reading back as exactly that change, and is refused otherwise", () => {
    fc.assert(
      fc.property(jsoncFile, jsonPath, entry, ({ text, plain }, at, next) => {
        const before = reference(plain);
        const result = setInJsonc(text, at, next);
        if (!settable(before, at)) {
          expect(result.isErr()).toBe(true);
          return;
        }
        expect(result.isOk(), result.isErr() ? `${result.error}\n${text}` : "").toBe(true);
        expect(reference(withoutBom(result._unsafeUnwrap()))).toEqual(setIn(before, at, next));
      }),
      { numRuns: 2000 },
    );
  });

  test("changes nothing but the value: a new one loses nothing of the text, a replaced one keeps what's around it", () => {
    fc.assert(
      fc.property(jsoncFile, jsonPath, entry, ({ text, plain, bom }, at, next) => {
        fc.pre(settable(reference(plain), at));
        const out = setInJsonc(text, at, next)._unsafeUnwrap();
        const tree = jsonc.parseTree(plain, [], PARSE_OPTIONS);
        const old = tree && jsonc.findNodeAtLocation(tree, at);
        if (old) {
          const start = old.offset + (bom ? 1 : 0);
          expect(out.slice(0, start)).toBe(text.slice(0, start));
          expect(out.endsWith(text.slice(start + old.length))).toBe(true);
        } else {
          expect(comments(withoutBom(out))).toEqual(comments(plain));
          expect(within(squeezed(text), squeezed(out))).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("an agent's JSON config on disk", () => {
  const BRIDGE = "/Users/me/.antidraw/bin/antidraw";
  let home: string;
  let machine: Machine;
  beforeAll(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-setup-property-")));
    machine = { home, env: {}, platform: "darwin" };
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  test("gets the server once: added, it reads as added, and adding it again changes nothing", () => {
    const agents = fc.constantFrom(...(["claude", "cursor", "vscode", "opencode", "pi"] as const));
    fc.assert(
      fc.property(jsoncFile, agents, ({ text }, id) => {
        fs.rmSync(home, { recursive: true, force: true });
        const file = agentConfigFile(id, machine);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);

        fc.pre(addAgentServer(id, BRIDGE, machine).isOk());
        const written = fs.readFileSync(file, "utf-8");
        reference(withoutBom(written));
        expect(hasAgentServer(id, BRIDGE, machine)).toBe(true);
        expect(addAgentServer(id, BRIDGE, machine).isOk()).toBe(true);
        expect(fs.readFileSync(file, "utf-8")).toBe(written);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Codex's TOML

// Paths as an app's config can hold them: spaces, quotes, backslashes, more than ASCII.
const BRIDGES = [
  "/Users/me/.antidraw/bin/antidraw",
  "/Users/my name/.antidraw/bin/antidraw",
  "C:\\Users\\me\\.antidraw\\bin\\antidraw",
  '/tmp/"quoted"/antidraw',
  "/tmp/é/😀/antidraw",
];
const bridge = fc.constantFrom(...BRIDGES);

const hex = (c: string, width: number) => c.codePointAt(0)!.toString(16).padStart(width, "0");

// Each way a TOML key can be written: bare when it can be, quoted, escaped.
const keyVariants = (name: string) => [
  ...(/^[A-Za-z0-9_-]+$/.test(name) ? [name, name] : []),
  JSON.stringify(name),
  ...(name.includes("'") ? [] : [`'${name}'`]),
  `"${[...name].map((c) => `\\u${hex(c, 4)}`).join("")}"`,
  `"${[...name].map((c, i) => (i === 1 ? `\\U${hex(c, 8)}` : c.replace(/["\\]/g, "\\$&"))).join("")}"`,
];
const tomlKey = (name: string) => fc.constantFrom(...keyVariants(name));
const dotted = (names: string[]) =>
  fc.tuple(fc.tuple(...names.map(tomlKey)), fc.constantFrom(".", " . ")).map(([parts, dot]) => parts.join(dot));

const tomlChars = fc
  .array(fc.constantFrom("a", " ", "#", "[", "]", "=", '"', "'", "\\", "é", "😀", "\t"), { maxLength: 8 })
  .map((cs) => cs.join(""));
// Inside a multi-line string: lines that look like a table, a key or a comment,
// escaped quotes beside real ones, a line ending in a backslash.
const multiBasic = fc
  .array(fc.constantFrom("\n", "a", " ", "[mcp_servers.antidraw]", 'command = "x"', "# no", '\\"""', "\\\\", '"', "\\n", "'''", "\\\n"), {
    maxLength: 8,
  })
  .map((parts) => `"""${parts.join("")}"""`);
const multiLiteral = fc
  .array(fc.constantFrom("\n", "a", "[mcp_servers.antidraw]", '"""', "#", "\\", "'"), { maxLength: 8 })
  .map((parts) => `'''${parts.join("")}'''`);

const tomlString = fc.oneof(
  tomlChars.map((s) => JSON.stringify(s)),
  tomlChars.filter((s) => !s.includes("'")).map((s) => `'${s}'`),
  multiBasic,
  multiLiteral,
);
const tomlValue = fc.oneof(
  { weight: 3, arbitrary: tomlString },
  fc.integer().map(String),
  fc.constantFrom("true", "false"),
  fc.array(tomlString, { maxLength: 3 }).map((items) => `[${items.join(", ")}]`),
  // An array on several lines, with comments in it.
  fc.array(tomlString, { maxLength: 3 }).map((items) => `[\n${items.map((i) => `  ${i}, # [x]\n`).join("")}]`),
  fc
    .uniqueArray(fc.tuple(fc.constantFrom("A", "B", "c d"), tomlString), { selector: ([k]) => k, maxLength: 2 })
    .chain((pairs) =>
      fc
        .tuple(...pairs.map(([k, v]) => tomlKey(k).map((key) => `${key} = ${v}`)))
        .map((items) => (items.length ? `{ ${items.join(", ")} }` : "{}")),
    ),
);
const comment = fc.constantFrom("", " # a note", " # [mcp_servers.antidraw]", ' # command = "x"');
const assignment = (names: string[], value: fc.Arbitrary<string>) =>
  fc.tuple(dotted(names), fc.constantFrom(" = ", "=", "  =  "), value, comment).map(([k, eq, v, c]) => `${k}${eq}${v}${c}`);

// A table's keys, other than antidraw's: never a key a header below also makes.
const ENTRY_KEYS = ["model", "url", "enabled", "startup_timeout_sec", "note"];
const entries = fc
  .uniqueArray(fc.constantFrom(...ENTRY_KEYS), { maxLength: 3 })
  .chain((keys) => fc.tuple(...keys.map((k) => assignment([k], tomlValue))));

const header = (names: string[]) =>
  fc
    .tuple(fc.constantFrom("", "  "), dotted(names), fc.constantFrom("", " "), comment)
    .map(([indent, key, pad, c]) => `${indent}[${pad}${key}${pad}]${c}`);

// Our server as Antidraw, `codex mcp add` or a person would write it: the
// command on its own line, the arguments ["mcp"], maybe more keys beside them.
const antidrawTable = (bridges: string[]) =>
  fc
    .tuple(
      header(["mcp_servers", "antidraw"]),
      fc.constantFrom(...bridges).chain((b) =>
        fc.constantFrom(JSON.stringify(b), ...(b.includes("'") ? [] : [`'${b}'`])),
      ),
      fc.constantFrom('["mcp"]', "['mcp']", '[ "mcp", ]', '["mcp", "--verbose"]'),
      entries,
    )
    .map(([h, command, args, rest]) => [h, `command = ${command}`, `args = ${args}`, ...rest].join("\n"));

const TABLES = [
  ["mcp_servers", "github"],
  ["mcp_servers", "anti draw"],
  ["mcp_servers", "a.b"],
  ["mcp_servers", "github", "env"],
  ["mcp_servers", "antidraw", "env"],
  ["features"],
  ["profiles", "work"],
  ["mcp_servers"],
];

// A config.toml written with tables: what Codex's own `codex mcp add` makes
// and what people write by hand. "Add" must be able to edit every one that has
// no antidraw server.
const tomlBlock = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0, max: TABLES.length - 1 }).map((i) => ({ table: i })) },
  { weight: 1, arbitrary: fc.constant({ table: "antidraw" as const }) },
  { weight: 1, arbitrary: fc.constantFrom("", "# [mcp_servers.antidraw]", "#").map((line) => ({ line })) },
);
const tomlFile = (bridges: string[], hostile: fc.Arbitrary<string[]>) =>
  fc
    .record({
      root: fc.array(assignment(["approval_policy"], tomlValue), { maxLength: 1 }),
      blocks: fc.uniqueArray(tomlBlock, { selector: (b) => ("table" in b ? b.table : Symbol()), maxLength: 5 }),
      hostile,
      newline: fc.constantFrom("\n", "\r\n"),
      end: fc.constantFrom("", "\n", "\n\n"),
    })
    .chain(({ root, blocks, hostile, newline, end }) =>
      fc
        .tuple(
          ...blocks.map((b) =>
            "line" in b
              ? fc.constant(b.line)
              : b.table === "antidraw"
                ? antidrawTable(bridges)
                : fc.tuple(header(TABLES[b.table]!), entries).map(([h, e]) => [h, ...e].join("\n")),
          ),
        )
        .map((parts) => {
          const lines = [...hostile.filter((h) => !h.startsWith("[")), ...root, ...parts, ...hostile.filter((h) => h.startsWith("["))];
          return lines.join("\n").replaceAll("\n", newline) + (lines.length ? end : "");
        }),
    );

// What else a config can say about antidraw, each valid TOML: "Add" may refuse
// these, but never write them wrong.
const HOSTILE = [
  'mcp_servers.antidraw.command = "/x"',
  'mcp_servers = { antidraw = { command = "/x", args = ["mcp"] } }',
  '[mcp_servers]\nantidraw = { command = "/x" }',
  '[mcp_servers]\nantidraw.command = "/x"',
  '[[mcp_servers]]\nname = "x"',
  '[mcp_servers.antidraw]\ncommand = """\n/x"""\nargs = [\n  "mcp",\n]',
  '[mcp_servers."antidraw"]\nurl = "http://127.0.0.1:47821/mcp"',
];
const hostile = fc.uniqueArray(fc.constantFrom(...HOSTILE), { maxLength: 2 });

const plainFile = tomlFile(BRIDGES, fc.constant([]));
const anyFile = tomlFile([...BRIDGES, "/other/antidraw"], hostile);

// The file by smol-toml; null when it isn't TOML, which the generators rarely
// make (quotes that run together, a key two tables make).
const parsedToml = (text: string): Record<string, unknown> | null => {
  try {
    return toml.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const serverIn = (config: Record<string, unknown>) =>
  isObject(config.mcp_servers) ? config.mcp_servers.antidraw : undefined;
const runsBridge = (server: unknown, b: string) =>
  isObject(server) && server.command === b && JSON.stringify(server.args) === '["mcp"]';

describe("Codex's config.toml", () => {
  test("gets our table, reading back as smol-toml has it, wherever the file has no antidraw server", () => {
    fc.assert(
      fc.property(plainFile, bridge, (text, b) => {
        const before = parsedToml(text);
        fc.pre(before !== null && serverIn(before) === undefined);
        const result = addCodexServer(text, b);
        expect(result.isOk(), result.isErr() ? `${result.error}\n${text}` : "").toBe(true);
        expect(parsedToml(result._unsafeUnwrap())).toEqual({
          ...before,
          mcp_servers: { ...(before.mcp_servers as object), antidraw: { command: b, args: ["mcp"] } },
        });
      }),
      { numRuns: 1000 },
    );
  });

  test("says it has the server exactly when smol-toml reads our command there", () => {
    fc.assert(
      fc.property(plainFile, bridge, (text, b) => {
        const before = parsedToml(text);
        fc.pre(before !== null);
        expect(codexHasServer(text, b), text).toBe(runsBridge(serverIn(before), b));
      }),
      { numRuns: 1000 },
    );
  });

  test("is never written wrong, whatever it says about antidraw, and adding twice is adding once", () => {
    fc.assert(
      fc.property(anyFile, bridge, (text, b) => {
        const before = parsedToml(text);
        fc.pre(before !== null);
        if (codexHasServer(text, b)) expect(runsBridge(serverIn(before), b)).toBe(true);
        const result = addCodexServer(text, b);
        if (result.isErr()) return;
        const out = result.value;
        if (out === text) {
          expect(runsBridge(serverIn(before), b)).toBe(true);
          return;
        }
        // Appended: what was there is kept, and a table under antidraw's
        // (its env, say) gets its command beside it.
        const had = serverIn(before);
        expect(had === undefined || (isObject(had) && !("command" in had) && !("args" in had))).toBe(true);
        expect(out.startsWith(text)).toBe(true);
        expect(parsedToml(out)).toEqual({
          ...before,
          mcp_servers: { ...(before.mcp_servers as object), antidraw: { ...(had as object), command: b, args: ["mcp"] } },
        });
        expect(codexHasServer(out, b)).toBe(true);
        expect(addCodexServer(out, b)._unsafeUnwrap()).toBe(out);
      }),
      { numRuns: 1000 },
    );
  });
});

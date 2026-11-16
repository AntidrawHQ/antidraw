import { isDeepStrictEqual } from "node:util";
import { err, ok, type Result } from "neverthrow";
import { parse } from "smol-toml";

// Codex keeps its MCP servers in config.toml, one table each:
//
//   [mcp_servers.antidraw]
//   command = "/Users/me/.antidraw/bin/antidraw"
//   args = ["mcp"]
//
// Adding ours is appending that table, so the rest of the file keeps its
// text. The file is read with a TOML parser, before and after: one it can't
// read is left alone, and the table is kept only when the file it makes reads
// back with our server in it. Where antidraw is already written some way a
// table can't be added to (an inline table, dotted keys), the file with it
// appended isn't TOML, and nothing is written.

type Table = Record<string, unknown>;

const isTable = (value: unknown): value is Table =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

const read = (text: string): Result<Table, string> => {
  try {
    return ok(parse(text) as Table);
  } catch (e) {
    // Its first line: where, and what. The rest is the file's text.
    return err(`it isn't valid TOML (${String((e as Error).message).split("\n")[0]})`);
  }
};

const serverIn = (config: Table) => (isTable(config.mcp_servers) ? config.mcp_servers.antidraw : undefined);

const runs = (server: unknown, bridge: string) =>
  isTable(server) && server.command === bridge && isDeepStrictEqual(server.args, ["mcp"]);

// Whether the file already runs `<bridge> mcp` as its antidraw server.
export const codexHasServer = (text: string, bridge: string) =>
  read(text)
    .map((config) => runs(serverIn(config), bridge))
    .unwrapOr(false);

// The file with our table at its end; the file itself when it's there already.
export const addCodexServer = (text: string, bridge: string): Result<string, string> =>
  read(text).andThen((config) => {
    const server = serverIn(config);
    if (runs(server, bridge)) return ok(text);
    // Only a table under antidraw's own (its env, say) can be there already.
    if (server !== undefined && (!isTable(server) || Object.keys(server).some((key) => !isTable(server[key]))))
      return err("it already has an antidraw server, set up another way");

    const gap = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    // A JSON string is a TOML basic string.
    const next = `${text}${gap}[mcp_servers.antidraw]\ncommand = ${JSON.stringify(bridge)}\nargs = ["mcp"]\n`;
    const after = read(next);
    if (after.isErr() || !runs(serverIn(after.value), bridge))
      return err(
        server === undefined
          ? "its mcp_servers is written in a way a table can't be added to"
          : "it already has an antidraw server, set up another way",
      );
    return ok(next);
  });

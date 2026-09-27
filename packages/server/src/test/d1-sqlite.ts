/// <reference types="node" />
// A D1Database over node:sqlite, for store tests that need real SQL semantics
// (row values, RETURNING, constraint failures, batch rollback) without
// wrangler. It applies this package's migrations, enforces foreign keys as D1
// does, and throws on the D1 limits the store must respect: more than 100
// bound parameters in one statement (also inside a batch), more than
// 100 000 bytes of SQL, and a row or a bound value over 2 000 000 bytes. It covers SQL
// semantics only; real D1 is covered by the local end-to-end recipe
// (README → Publish).
//
// node:sqlite needs Node >= 22.5, so callers guard with `hasNodeSqlite`.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DatabaseSync, StatementSync } from "node:sqlite";

const require = createRequire(import.meta.url);

const loadSqlite = (): typeof import("node:sqlite") | null => {
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } catch {
    return null;
  }
};

const sqlite = loadSqlite();
export const hasNodeSqlite = sqlite !== null;

export const D1_MAX_BOUND_PARAMS = 100;
export const D1_MAX_SQL_BYTES = 100_000;
// D1 caps a string, a BLOB and a whole row (the record SQLite builds for it)
// at this many bytes.
export const D1_MAX_ROW_BYTES = 2_000_000;

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

type Value = null | number | bigint | string | Uint8Array;

const toSqlite = (value: unknown): Value => {
  if (value === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as Value;
};

const checkLimits = (sql: string, params: unknown[]) => {
  if (params.length > D1_MAX_BOUND_PARAMS) {
    throw new Error(
      `D1 limit: ${params.length} bound parameters in one statement (max ${D1_MAX_BOUND_PARAMS})`,
    );
  }
  if (Buffer.byteLength(sql, "utf8") > D1_MAX_SQL_BYTES) {
    throw new Error(`D1 limit: statement longer than ${D1_MAX_SQL_BYTES} bytes`);
  }
  for (const param of params) {
    if (typeof param === "string" && Buffer.byteLength(param, "utf8") > D1_MAX_ROW_BYTES) {
      throw new Error("string or blob too big");
    }
  }
};

// node:sqlite cannot lower SQLITE_LIMIT_LENGTH, so a trigger per table
// refuses an INSERT or UPDATE whose values add up to more than D1's row
// limit, with SQLite's own message for it.
const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const enforceRowLimit = (db: DatabaseSync) => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as {
      name: string;
    }[];
    const bytes = columns
      .map((c) => `coalesce(length(CAST(NEW.${quoteIdent(c.name)} AS BLOB)), 0)`)
      .join(" + ");
    for (const event of ["INSERT", "UPDATE"]) {
      db.exec(`CREATE TRIGGER ${quoteIdent(`d1_row_limit_${event}_${name}`)}
        BEFORE ${event} ON ${quoteIdent(name)}
        WHEN ${bytes} > ${D1_MAX_ROW_BYTES}
        BEGIN SELECT RAISE(ABORT, 'string or blob too big'); END`);
    }
  }
};

const returnsRows = (sql: string) => /^\s*(select|with|values|pragma)\b|\breturning\b/i.test(sql);

type Log = { sql: string; params: number }[];

class ShimStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly log: Log,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new ShimStatement(this.db, this.log, this.sql, values);
  }

  private prepared(): { stmt: StatementSync; params: Value[] } {
    checkLimits(this.sql, this.params);
    return { stmt: this.db.prepare(this.sql), params: this.params.map(toSqlite) };
  }

  private changes() {
    return Number(
      (this.db.prepare("SELECT changes() AS n").get() as { n: number } | undefined)?.n ?? 0,
    );
  }

  execute(): D1Result {
    this.log.push({ sql: this.sql, params: this.params.length });
    const { stmt, params } = this.prepared();
    if (returnsRows(this.sql)) {
      const results = stmt.all(...params) as Record<string, unknown>[];
      return {
        success: true,
        results,
        meta: meta(/^\s*(select|with|values|pragma)\b/i.test(this.sql) ? 0 : this.changes()),
      };
    }
    const outcome = stmt.run(...params);
    return {
      success: true,
      results: [],
      meta: meta(Number(outcome.changes), Number(outcome.lastInsertRowid)),
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute() as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute() as D1Result<T>;
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (this.execute().results[0] ?? null) as Record<string, unknown> | null;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const rows = this.execute().results as Record<string, unknown>[];
    const arrays = rows.map((row) => Object.values(row)) as T[];
    if (options?.columnNames) {
      const { stmt } = this.prepared();
      const names = stmt.columns().map((c) => c.name) as T;
      return [names, ...arrays];
    }
    return arrays;
  }
}

const meta = (changes: number, lastRowId = 0) => ({
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: changes,
  last_row_id: lastRowId,
  changed_db: changes > 0,
  changes,
});

export type D1Shim = D1Database & {
  // The underlying database, for test setup and assertions.
  sqlite: DatabaseSync;
  // Every statement executed, in order (SQL text and bound parameter count).
  log: Log;
};

export const createD1Shim = (): D1Shim => {
  if (!sqlite) throw new Error("node:sqlite is not available (Node >= 22.5 required)");
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) db.exec(statement);
    }
  }
  enforceRowLimit(db);

  const log: Log = [];
  const shim = {
    sqlite: db,
    log,
    prepare: (query: string) => new ShimStatement(db, log, query),
    // D1 runs a batch as one transaction: any failing statement rolls back all.
    async batch(statements: ShimStatement[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((stmt) => stmt.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(query: string) {
      db.exec(query);
      return { count: 1, duration: 0 };
    },
  };
  return shim as unknown as D1Shim;
};

// Test fixture: a user row for the store's foreign keys.
export const insertUser = (shim: D1Shim, id: string) => {
  shim.sqlite
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)",
    )
    .run(id, id, `${id}@example.com`);
};

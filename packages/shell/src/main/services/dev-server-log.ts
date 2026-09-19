import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

// Rotate once the log passes this size: the current file becomes `.1`
// (replacing any previous `.1`) and a fresh file starts. Keeps history
// bounded at ~2x without losing the tail of the previous run.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

export type LogStreamName = "out" | "err";

/**
 * Turns a chunked byte stream into whole lines. `data` events are not
 * line-aligned, so the trailing partial line is held until the next chunk
 * (or flushed on end).
 */
export const createLineSplitter = (onLine: (line: string) => void) => {
  let pending = "";
  return {
    push(chunk: Buffer | string) {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    },
    flush() {
      if (pending) onLine(pending);
      pending = "";
    },
  };
};

export const formatLogLine = (
  stream: LogStreamName,
  text: string,
  ts: Date = new Date()
) => `${ts.toISOString()} [${stream}] ${stripAnsi(text).replace(/\r$/, "")}\n`;

const rotateIfLarge = (logPath: string) => {
  try {
    if (fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
    // Missing file: nothing to rotate.
  }
};

export type DevServerLog = {
  path: string;
  /** Attach a child's stdout/stderr; lines are timestamped and tagged. */
  attach(stream: Readable, name: LogStreamName): void;
  /** Write a run marker (start/exit); not tagged with a stream. */
  marker(text: string): void;
  /** Flush pending partial lines and end the file; resolves once written. */
  close(): Promise<void>;
};

/**
 * Append-only run log for a workspace's dev server. Every run appends to the
 * same file with start/exit markers so the agent can see history, not just
 * the current run.
 */
export const openDevServerLog = (logPath: string): DevServerLog => {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateIfLarge(logPath);
  const out = fs.createWriteStream(logPath, { flags: "a" });
  // A write error (disk full, permissions) must not take down the main
  // process; the dev server itself is unaffected.
  out.on("error", (e) => console.error(`dev-server log ${logPath}:`, e));

  const splitters: ReturnType<typeof createLineSplitter>[] = [];

  return {
    path: logPath,
    attach(stream, name) {
      const splitter = createLineSplitter((line) => {
        out.write(formatLogLine(name, line));
      });
      splitters.push(splitter);
      stream.on("data", (chunk: Buffer) => splitter.push(chunk));
      stream.on("end", () => splitter.flush());
    },
    marker(text) {
      out.write(`=== ${text} ${new Date().toISOString()} ===\n`);
    },
    close() {
      for (const s of splitters) s.flush();
      return new Promise((resolve) => out.end(resolve));
    },
  };
};

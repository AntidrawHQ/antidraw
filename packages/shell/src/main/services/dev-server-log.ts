import fs from "node:fs";
import path from "node:path";

// Rotate once the log passes this size: the current file becomes `.1`
// (replacing any previous `.1`) and a fresh file starts. Keeps history
// bounded at ~2x without losing the tail of the previous run.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export type DevServerLog = {
  write: (chunk: string | Buffer) => void;
  /** Writes `tail` and closes; resolves once flushed. */
  end: (tail: string) => Promise<void>;
  /**
   * Same, synchronously. For app quit, where the process exits before a
   * stream flush could land.
   */
  endSync: (tail: string) => void;
};

const endsMidLine = (logPath: string, size: number): boolean => {
  const fd = fs.openSync(logPath, "r");
  try {
    const last = Buffer.alloc(1);
    fs.readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 10;
  } finally {
    fs.closeSync(fd);
  }
};

/**
 * Append-only log for a workspace's dev server. The service writes the
 * child's stdout/stderr in unprocessed, with a start/exit marker around each
 * run so history stays readable.
 *
 * Best-effort: never throws. If the log can't be opened or a write fails
 * (disk full, permissions) it goes inert and the dev server carries on
 * without it.
 */
export const openDevServerLog = (logPath: string): DevServerLog => {
  let out: fs.WriteStream | null = null;
  // Whether the last byte in the log is not a newline, so a marker would be
  // glued onto a partial line (a killed process rarely ends on a newline).
  let midLine = false;

  const fail = (e: unknown) => {
    console.error(`dev-server log ${logPath}:`, e);
    out?.destroy();
    out = null;
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const size = fs.statSync(logPath, { throwIfNoEntry: false })?.size ?? 0;
    if (size > MAX_LOG_BYTES) {
      try {
        fs.renameSync(logPath, `${logPath}.1`);
      } catch {
        // Can't rotate: keep appending to the oversized file.
        midLine = endsMidLine(logPath, size);
      }
    } else if (size > 0) {
      midLine = endsMidLine(logPath, size);
    }
    out = fs.createWriteStream(logPath, { flags: "a" });
    out.on("error", fail);
    if (midLine) {
      out.write("\n");
      midLine = false;
    }
  } catch (e) {
    fail(e);
  }

  const lineStart = () => (midLine ? "\n" : "");

  return {
    write: (chunk) => {
      if (!out || chunk.length === 0) return;
      out.write(chunk);
      const last = chunk[chunk.length - 1];
      midLine = last !== "\n" && last !== 10;
    },
    end: (tail) =>
      new Promise<void>((resolve) => {
        if (!out) return resolve();
        const stream = out;
        out = null;
        stream.end(lineStart() + tail, () => resolve());
      }),
    endSync: (tail) => {
      if (!out) return;
      out.destroy();
      out = null;
      try {
        fs.appendFileSync(logPath, lineStart() + tail);
      } catch (e) {
        console.error(`dev-server log ${logPath}:`, e);
      }
    },
  };
};

export const logMarker = (text: string) =>
  `=== ${text} ${new Date().toISOString()} ===\n`;

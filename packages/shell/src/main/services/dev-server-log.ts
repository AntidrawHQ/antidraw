import fs from "node:fs";
import path from "node:path";

// Rotate once the log passes this size: the current file becomes `.1`
// (replacing any previous `.1`) and a fresh file starts. Keeps history
// bounded at ~2x without losing the tail of the previous run.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Append-only log for a workspace's dev server. The child's stdout/stderr
 * are piped straight in, unprocessed; the service writes a start/exit marker
 * around each run so history stays readable.
 */
export const openDevServerLog = (logPath: string): fs.WriteStream => {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  try {
    if (fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
    // Missing file: nothing to rotate.
  }
  const out = fs.createWriteStream(logPath, { flags: "a" });
  // A write error (disk full, permissions) must not take down the main
  // process; the dev server itself is unaffected.
  out.on("error", (e) => console.error(`dev-server log ${logPath}:`, e));
  return out;
};

export const logMarker = (text: string) =>
  `=== ${text} ${new Date().toISOString()} ===\n`;

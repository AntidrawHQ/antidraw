import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logMarker, openDevServerLog } from "@/main/services/dev-server-log";

const readLog = (p: string) =>
  fs
    .readFileSync(p, "utf8")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");

const endLog = (log: fs.WriteStream, tail: string) =>
  new Promise<void>((resolve) => log.end(tail, resolve));

describe("openDevServerLog", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("appends across runs with markers; creates the logs dir", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "logs", "dev-server.log");

    const run1 = openDevServerLog(p);
    run1.write(logMarker("dev server started pid=1 port=5173"));
    run1.write("VITE ready\n");
    await endLog(run1, logMarker("dev server exited code=0"));

    const run2 = openDevServerLog(p);
    await endLog(run2, logMarker("dev server started pid=2 port=5174"));

    expect(readLog(p)).toMatchInlineSnapshot(`
      "=== dev server started pid=1 port=5173 <ts> ===
      VITE ready
      === dev server exited code=0 <ts> ===
      === dev server started pid=2 port=5174 <ts> ===
      "
    `);
  });

  test("rotates a large log to .1 on open", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "dev-server.log");
    fs.writeFileSync(p, "x".repeat(5 * 1024 * 1024 + 1));

    const log = openDevServerLog(p);
    await endLog(log, logMarker("dev server started pid=3 port=1"));

    expect(fs.statSync(`${p}.1`).size).toBe(5 * 1024 * 1024 + 1);
    expect(readLog(p)).toMatchInlineSnapshot(`
      "=== dev server started pid=3 port=1 <ts> ===
      "
    `);
  });
});

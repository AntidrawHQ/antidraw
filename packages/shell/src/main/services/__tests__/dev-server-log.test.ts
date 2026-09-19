import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logMarker, openDevServerLog } from "@/main/services/dev-server-log";

const readLog = (p: string) =>
  fs
    .readFileSync(p, "utf8")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");

describe("openDevServerLog", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("appends across runs with markers; creates the logs dir", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "logs", "dev-server.log");

    const run1 = openDevServerLog(p);
    run1.write(logMarker("dev server started pid=1 port=5173"));
    run1.write("VITE ready\n");
    await run1.end(logMarker("dev server exited code=0"));

    const run2 = openDevServerLog(p);
    await run2.end(logMarker("dev server started pid=2 port=5174"));

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
    await log.end(logMarker("dev server started pid=3 port=1"));

    expect(fs.statSync(`${p}.1`).size).toBe(5 * 1024 * 1024 + 1);
    expect(readLog(p)).toMatchInlineSnapshot(`
      "=== dev server started pid=3 port=1 <ts> ===
      "
    `);
  });

  test("markers never land mid-line", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "dev-server.log");
    // Previous run was killed mid-write, without an exit marker.
    fs.writeFileSync(p, "transforming (42) src/App.tsx");

    const log = openDevServerLog(p);
    log.write(logMarker("dev server started pid=4 port=1"));
    log.write(Buffer.from("partial"));
    await log.end(logMarker("dev server exited code=null"));

    expect(readLog(p)).toMatchInlineSnapshot(`
      "transforming (42) src/App.tsx
      === dev server started pid=4 port=1 <ts> ===
      partial
      === dev server exited code=null <ts> ===
      "
    `);
  });

  test("endSync writes the tail before returning; later calls are no-ops", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "dev-server.log");

    const log = openDevServerLog(p);
    log.endSync(logMarker("dev server stopped (app quit)"));
    const afterSync = readLog(p);
    log.write("late\n");
    await log.end(logMarker("dev server exited code=0"));

    expect(afterSync).toMatchInlineSnapshot(`
      "=== dev server stopped (app quit) <ts> ===
      "
    `);
    expect(readLog(p)).toBe(afterSync);
  });

  test("an unopenable log is inert instead of throwing", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    // A plain file where the logs dir should be: mkdir fails.
    fs.writeFileSync(path.join(dir, "logs"), "");
    const p = path.join(dir, "logs", "dev-server.log");

    const log = openDevServerLog(p);
    log.write("VITE ready\n");
    await log.end(logMarker("dev server exited code=0"));
    log.endSync(logMarker("dev server stopped (app quit)"));

    expect(fs.existsSync(p)).toBe(false);
  });
});

import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  createLineSplitter,
  formatLogLine,
  openDevServerLog,
  stripAnsi,
} from "@/main/services/dev-server-log";

describe("createLineSplitter", () => {
  test("joins partial chunks and emits whole lines only", () => {
    const lines: string[] = [];
    const s = createLineSplitter((l) => lines.push(l));
    s.push("ready in ");
    s.push("120 ms\n  ➜  Local: http://loc");
    expect(lines).toEqual(["ready in 120 ms"]);
    s.push("alhost:5173/\n");
    expect(lines).toEqual(["ready in 120 ms", "  ➜  Local: http://localhost:5173/"]);
  });

  test("flush emits the trailing partial line", () => {
    const lines: string[] = [];
    const s = createLineSplitter((l) => lines.push(l));
    s.push("no newline");
    s.flush();
    s.flush();
    expect(lines).toEqual(["no newline"]);
  });
});

describe("formatLogLine", () => {
  test("stamps, tags, strips ANSI and CR", () => {
    const ts = new Date("2026-09-19T10:00:00.000Z");
    expect(formatLogLine("err", "\x1b[31mError\x1b[0m: boom\r", ts)).toBe(
      "2026-09-19T10:00:00.000Z [err] Error: boom\n"
    );
  });

  test("stripAnsi handles cursor/format sequences", () => {
    expect(stripAnsi("\x1b[2K\x1b[1G\x1b[36mvite\x1b[39m")).toBe("vite");
  });
});

describe("openDevServerLog", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("appends across runs with markers, tagged lines", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "dev-server.log");

    const run1 = openDevServerLog(p);
    const out = new PassThrough();
    run1.marker("dev server started pid=1 port=5173");
    run1.attach(out, "out");
    out.write("VITE ready\n");
    out.end();
    await new Promise((r) => out.on("end", r));
    run1.marker("dev server exited code=0");
    await run1.close();

    const run2 = openDevServerLog(p);
    run2.marker("dev server started pid=2 port=5174");
    await run2.close();

    const text = fs.readFileSync(p, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^=== dev server started pid=1 port=5173 .* ===$/);
    expect(lines[1]).toMatch(/^\S+ \[out\] VITE ready$/);
    expect(lines[2]).toMatch(/^=== dev server exited code=0 /);
    expect(lines[3]).toMatch(/^=== dev server started pid=2 port=5174 /);
  });

  test("rotates a large log to .1 on open", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-log-"));
    const p = path.join(dir, "dev-server.log");
    fs.writeFileSync(p, "x".repeat(5 * 1024 * 1024 + 1));

    const log = openDevServerLog(p);
    log.marker("dev server started pid=3 port=1");
    await log.close();

    expect(fs.statSync(`${p}.1`).size).toBe(5 * 1024 * 1024 + 1);
    expect(fs.readFileSync(p, "utf8")).toMatch(/^=== dev server started pid=3/);
  });
});

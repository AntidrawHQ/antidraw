import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ok, err } from "neverthrow";

// A real child process (the fake build script below, run by this Node as the
// app runs the Electron binary as Node); only the Electron-bound edges are
// mocked: the app's resource paths, the database, and $HOME for the node shim.
const h = vi.hoisted(() => ({
  root: "",
  resources: null as null | { viewerDir: string; runtimeSrc: string; buildScript: string },
  layouts: [] as { workspaceId: string; componentName: string; x: number; y: number; width: number; height: number }[],
}));

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => h.root } }));
vi.mock("@/main/api/init", () => ({ getAntidrawRoot: () => h.root }));
vi.mock("@/main/services/publish/resources", () => ({
  getPublishResources: () =>
    h.resources
      ? ok(h.resources)
      : err({ code: "RESOURCES_MISSING", message: "Publishing needs files the app does not have" }),
}));
vi.mock("@/main/api/services/frame-layout.service", () => ({
  getFrameLayouts: async () => ok(h.layouts),
}));

import { buildEnv, buildWorkspaceSite } from "@/main/services/publish/site-builder";

const FAKE_CHILD = path.join(import.meta.dirname, "fixtures", "fake-build-child.mjs");

let tmp: string;
let staged: string;
let nodeModules: string;
let outDir: string;
let cacheDir: string;

const write = (file: string, content = "") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const setMode = (mode: "ok" | "fail" | "hang", lines = 0, grandchild?: "group" | "escaped") =>
  write(path.join(staged, "fake-build.json"), JSON.stringify({ mode, lines, grandchild }));

const grandchildPid = () => Number(fs.readFileSync(path.join(staged, "fake-build.grandchild.pid"), "utf8"));
const killQuietly = (pid: number) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

const build = (overrides: Partial<Parameters<typeof buildWorkspaceSite>[0]> = {}) =>
  buildWorkspaceSite({
    workspaceId: "ws-1",
    workspaceName: "My Canvas",
    stagedSourceDir: staged,
    nodeModulesDir: nodeModules,
    outDir,
    cacheDir,
    ...overrides,
  });

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-builder-")));
  h.root = path.join(tmp, "root");
  staged = path.join(tmp, "staging", "source");
  nodeModules = path.join(tmp, "workspace", "source", "node_modules");
  outDir = path.join(tmp, "staging", "site");
  cacheDir = path.join(tmp, "staging", "vite-cache");
  write(path.join(nodeModules, "vite", "package.json"), "{}");
  write(path.join(staged, "src/components/user-components/Button.tsx"), "export default 1");
  write(path.join(staged, "src/components/user-components/Alpha.tsx"), "export default 1");

  const viewerDir = path.join(tmp, "viewer");
  write(path.join(viewerDir, "index.html"), "<!doctype html><title>viewer</title>");
  write(path.join(viewerDir, "_antidraw", "viewer-AbCdEf12.js"), "viewer()");
  h.resources = { viewerDir, runtimeSrc: path.join(tmp, "runtime-src"), buildScript: FAKE_CHILD };
  h.layouts = [
    { workspaceId: "ws-1", componentName: "Button", x: 1, y: 2, width: 300, height: 200 },
    { workspaceId: "ws-1", componentName: "Deleted", x: 0, y: 0, width: 10, height: 10 },
  ];
  setMode("ok");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.VITE_SECRET;
  delete process.env.AWS_SECRET_ACCESS_KEY;
});

describe("buildWorkspaceSite", () => {
  test("builds the staged workspace and assembles the site", async () => {
    const logs: string[] = [];
    const result = await build({ onLog: (line) => logs.push(line) });
    expect(result.isOk()).toBe(true);
    const site = result._unsafeUnwrap();

    expect(site.dir).toBe(outDir);
    expect(site.componentCount).toBe(2);
    expect(site.entries.map((f) => f.path)).toEqual(["preview.html", "canvas.json", "index.html"]);
    expect(site.files.map((f) => [f.path, f.immutable])).toEqual([
      ["_antidraw/viewer-AbCdEf12.js", true],
      ["assets/index-AbCdEf12.js", true],
      ["robots.txt", false],
    ]);
    expect(site.skipped).toEqual([]);
    expect(site.totalBytes).toBe(
      [...site.files, ...site.entries].reduce((sum, f) => sum + fs.statSync(path.join(outDir, f.path)).size, 0),
    );

    expect(fs.readFileSync(path.join(outDir, "preview.html"), "utf8")).toContain("preview");
    expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8")).toContain("viewer");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "canvas.json"), "utf8"))).toEqual({
      version: 1,
      name: "My Canvas",
      components: [{ name: "Alpha" }, { name: "Button" }],
      layouts: [{ componentName: "Button", x: 1, y: 2, width: 300, height: 200 }],
    });

    // The child ran in the staged tree with the workspace's node_modules
    // linked in, and got the out dir, runtime source and cache dir.
    expect(logs).toContain(`NODE_MODULES ${nodeModules}`);
    const args = JSON.parse(logs.find((l) => l.startsWith("ARGS "))!.slice("ARGS ".length));
    expect(args).toEqual({ outDir, runtimeSrc: h.resources!.runtimeSrc, cacheDir });
  });

  test("the build child gets only allowlisted variables", async () => {
    process.env.VITE_SECRET = "s3cret";
    process.env.AWS_SECRET_ACCESS_KEY = "aws-s3cret";

    const env = buildEnv();
    expect(env.VITE_SECRET).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.PATH!.startsWith(path.join(h.root, "bin") + path.delimiter)).toBe(true);
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.NODE_ENV).toBe("production");

    const logs: string[] = [];
    const result = await build({ onLog: (line) => logs.push(line) });
    expect(result.isOk()).toBe(true);
    const keys = JSON.parse(logs.find((l) => l.startsWith("ENV "))!.slice("ENV ".length)) as string[];
    expect(keys).not.toContain("VITE_SECRET");
    expect(keys).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(keys).toEqual(expect.arrayContaining(["PATH", "HOME", "ELECTRON_RUN_AS_NODE", "NODE_ENV"]));
  });

  test("a failed build is BUILD_FAILED with the log tail, and leaves the out dir empty", async () => {
    setMode("fail", 100);
    const lines: [string, string][] = [];
    const result = await build({ onLog: (line, stream) => lines.push([line, stream]) });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("BUILD_FAILED");
    expect(error.logTail).toHaveLength(40);
    expect(error.logTail!.at(-1)).toBe("error: the build broke");
    expect(error.logTail).toContain("line 100");
    expect(lines).toContainEqual(["error: the build broke", "stderr"]);
    expect(lines).toContainEqual(["line 1", "stdout"]);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  test("abort kills the child and is CANCELLED", async () => {
    setMode("hang");
    const controller = new AbortController();
    const pending = build({
      signal: controller.signal,
      onLog: (line) => {
        if (line === "hanging") controller.abort();
      },
    });
    const result = await pending;

    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    const pid = Number(fs.readFileSync(path.join(staged, "fake-build.pid"), "utf8"));
    expect(isAlive(pid)).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "abort also stops a grandchild holding the output pipes, promptly",
    async () => {
      setMode("hang", 0, "group");
      const controller = new AbortController();
      const t0 = Date.now();
      const result = await build({
        signal: controller.signal,
        onLog: (line) => {
          if (line === "hanging") controller.abort();
        },
      });

      expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
      expect(Date.now() - t0).toBeLessThan(5000);
      const pid = grandchildPid();
      await new Promise((r) => setTimeout(r, 100));
      expect(isAlive(pid)).toBe(false);
    },
  );

  test("abort settles when the child exits, even if an escaped grandchild keeps the pipes open", async () => {
    setMode("hang", 0, "escaped");
    const controller = new AbortController();
    const t0 = Date.now();
    try {
      const result = await build({
        signal: controller.signal,
        onLog: (line) => {
          if (line === "hanging") controller.abort();
        },
      });
      expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
      expect(Date.now() - t0).toBeLessThan(5000);
    } finally {
      killQuietly(grandchildPid());
    }
  });

  test("a build that exits while an escaped grandchild keeps the pipes open still finishes", async () => {
    setMode("ok", 0, "escaped");
    const t0 = Date.now();
    try {
      const result = await build();
      expect(result.isOk()).toBe(true);
      expect(Date.now() - t0).toBeLessThan(6000);
    } finally {
      killQuietly(grandchildPid());
    }
  });

  test("an already aborted signal starts no build", async () => {
    const controller = new AbortController();
    controller.abort();
    const logs: string[] = [];
    const result = await build({ signal: controller.signal, onLog: (line) => logs.push(line) });
    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
    expect(logs).toEqual([]);
    expect(fs.existsSync(path.join(staged, "node_modules"))).toBe(false);
  });

  test("a build that runs too long is BUILD_TIMEOUT", async () => {
    setMode("hang");
    const result = await build({ timeoutMs: 500 });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("BUILD_TIMEOUT");
    expect(error.logTail).toContain("hanging");
    const pid = Number(fs.readFileSync(path.join(staged, "fake-build.pid"), "utf8"));
    expect(isAlive(pid)).toBe(false);
  });

  test("missing node_modules is DEPENDENCIES_MISSING", async () => {
    fs.rmSync(nodeModules, { recursive: true });
    const result = await build();
    expect(result._unsafeUnwrapErr().code).toBe("DEPENDENCIES_MISSING");
    expect(fs.existsSync(outDir)).toBe(false);
  });

  test("missing resources are RESOURCES_MISSING", async () => {
    h.resources = null;
    const result = await build();
    expect(result._unsafeUnwrapErr().code).toBe("RESOURCES_MISSING");
  });

  test("a workspace build that clashes with the site is SITE_ASSEMBLY_FAILED", async () => {
    // A workspace public/canvas.json, which the build copies to the out dir.
    const fixture = path.join(tmp, "clashing-child.mjs");
    write(
      fixture,
      `import fs from "node:fs";
       import path from "node:path";
       const out = process.argv[2];
       fs.mkdirSync(path.join(out, ".vite"), { recursive: true });
       fs.writeFileSync(path.join(out, "index.html"), "x");
       fs.writeFileSync(path.join(out, "canvas.json"), "{}");
       fs.writeFileSync(path.join(out, ".vite/antidraw-emitted.json"), "[]");`,
    );
    h.resources = { ...h.resources!, buildScript: fixture };
    const result = await build();
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("SITE_ASSEMBLY_FAILED");
    expect(error.message).toContain("canvas.json");
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  test("the node_modules link is removed afterwards, and what it led to is kept", async () => {
    const link = path.join(staged, "node_modules");

    expect((await build()).isOk()).toBe(true);
    expect(fs.lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();

    fs.rmSync(outDir, { recursive: true });
    setMode("fail");
    expect((await build()).isErr()).toBe(true);
    expect(fs.lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();

    expect(fs.existsSync(path.join(nodeModules, "vite", "package.json"))).toBe(true);
  });
});

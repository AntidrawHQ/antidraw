import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assembleSite,
  BUILD_EMITTED,
  checkOutDir,
  HASHED_FILES,
  makeCanvasFile,
  readCanvasComponents,
  USER_COMPONENTS_DIR,
} from "../site-build.ts";
import type { CanvasFile } from "../../viewer/canvas-file.ts";

let tmp: string;
let outDir: string;
let viewerDir: string;

const write = (file: string, content = "") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const canvas: CanvasFile = {
  version: 1,
  name: "My Canvas",
  components: [{ name: "Button" }],
  layouts: [{ componentName: "Button", x: 1, y: 2, width: 300, height: 200 }],
};

// What build-workspace.ts leaves in the out dir.
const fakeBuild = (emitted: string[]) => {
  write(path.join(outDir, "index.html"), "<!doctype html><title>preview</title>");
  write(path.join(outDir, "assets/index-AbCdEf12.js"), "console.log(1)");
  write(path.join(outDir, "assets/logo-XyZ98765.png"), "png");
  write(path.join(outDir, "robots.txt"), "User-agent: *");
  write(path.join(outDir, "clip.mp4"), "mp4");
  write(path.join(outDir, ".vite/other.json"), "{}");
  write(path.join(outDir, BUILD_EMITTED), JSON.stringify(emitted));
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-build-"));
  outDir = path.join(tmp, "site");
  viewerDir = path.join(tmp, "viewer");
  write(path.join(viewerDir, "index.html"), "<!doctype html><title>viewer</title>");
  write(path.join(viewerDir, "_antidraw/viewer-Qwerty12.js"), "viewer()");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("assembleSite", () => {
  test("turns the build into a site", () => {
    fakeBuild(["assets/index-AbCdEf12.js", "assets/logo-XyZ98765.png", "robots.txt", "index.html"]);
    const result = assembleSite({ outDir, viewerDir, canvas });

    expect(result._unsafeUnwrap()).toEqual({
      hashed: ["assets/index-AbCdEf12.js", "assets/logo-XyZ98765.png"],
    });
    expect(fs.readFileSync(path.join(outDir, "preview.html"), "utf8")).toContain("preview");
    expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8")).toContain("viewer");
    expect(fs.readFileSync(path.join(outDir, "_antidraw/viewer-Qwerty12.js"), "utf8")).toBe("viewer()");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, HASHED_FILES), "utf8"))).toEqual([
      "assets/index-AbCdEf12.js",
      "assets/logo-XyZ98765.png",
    ]);
    expect(fs.existsSync(path.join(outDir, ".vite"))).toBe(false);
    expect(fs.readFileSync(path.join(outDir, "canvas.json"), "utf8")).toBe(JSON.stringify(canvas, null, 2));
    expect(fs.readdirSync(outDir).sort()).toEqual(
      [HASHED_FILES, "_antidraw", "assets", "canvas.json", "clip.mp4", "index.html", "preview.html", "robots.txt"].sort(),
    );
  });

  test("a workspace canvas.json clashes: the out dir is emptied, keeping .git", () => {
    fakeBuild([]);
    write(path.join(outDir, "canvas.json"), "{}");
    write(path.join(outDir, ".git/HEAD"), "ref");

    const result = assembleSite({ outDir, viewerDir, canvas });
    expect(result._unsafeUnwrapErr()).toEqual({
      code: "SITE_ASSEMBLY_FAILED",
      message: "the workspace build has its own canvas.json (from public/?), which the site needs",
    });
    expect(fs.readdirSync(outDir)).toEqual([".git"]);
  });

  test("names the viewer uses clash too, but not index.html", () => {
    fakeBuild([]);
    write(path.join(outDir, "_antidraw/mine.js"), "");
    const result = assembleSite({ outDir, viewerDir, canvas });
    expect(result._unsafeUnwrapErr().message).toContain("_antidraw");
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  test("a build without index.html fails and is emptied", () => {
    fakeBuild([]);
    fs.rmSync(path.join(outDir, "index.html"));
    const result = assembleSite({ outDir, viewerDir, canvas });
    expect(result._unsafeUnwrapErr().message).toBe("the workspace build wrote no index.html");
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  test("a build without the emitted list fails and is emptied", () => {
    fakeBuild([]);
    fs.rmSync(path.join(outDir, BUILD_EMITTED));
    const result = assembleSite({ outDir, viewerDir, canvas });
    expect(result._unsafeUnwrapErr().code).toBe("SITE_ASSEMBLY_FAILED");
    expect(fs.readdirSync(outDir)).toEqual([]);
  });
});

describe("readCanvasComponents", () => {
  const components = () => path.join(tmp, "source", USER_COMPONENTS_DIR);

  test("lists .tsx files sorted by name, following symlinks, without unusable names or directories", () => {
    const dir = components();
    write(path.join(dir, "Zebra.tsx"));
    write(path.join(dir, "Apple.tsx"));
    write(path.join(dir, "mango.tsx"));
    write(path.join(dir, "notes.md"));
    write(path.join(dir, "Bad#Name.tsx"));
    write(path.join(dir, "What?.tsx"));
    write(path.join(dir, "Back\\slash.tsx"));
    write(path.join(dir, ".tsx"));
    fs.mkdirSync(path.join(dir, "Folder.tsx"));
    write(path.join(tmp, "elsewhere", "Linked.tsx"));
    fs.symlinkSync(path.join(tmp, "elsewhere", "Linked.tsx"), path.join(dir, "Linked.tsx"));
    fs.symlinkSync(path.join(tmp, "missing.tsx"), path.join(dir, "Broken.tsx"));

    expect(readCanvasComponents(path.join(tmp, "source"))).toEqual([
      { name: "Apple" },
      { name: "Linked" },
      { name: "Zebra" },
      { name: "mango" },
    ]);
  });

  test("no components directory is no components", () => {
    expect(readCanvasComponents(path.join(tmp, "nowhere"))).toEqual([]);
  });
});

describe("makeCanvasFile", () => {
  test("keeps only the layouts of listed components, and only their frame fields", () => {
    const layouts = [
      { componentName: "Button", x: 1, y: 2, width: 3, height: 4 },
      { componentName: "Deleted", x: 0, y: 0, width: 1, height: 1 },
      { componentName: "Card", x: 5, y: 6, width: 7, height: 8, workspaceId: "ws" },
    ];
    expect(makeCanvasFile("Name", [{ name: "Button" }, { name: "Card" }], layouts)).toEqual({
      version: 1,
      name: "Name",
      components: [{ name: "Button" }, { name: "Card" }],
      layouts: [
        { componentName: "Button", x: 1, y: 2, width: 3, height: 4 },
        { componentName: "Card", x: 5, y: 6, width: 7, height: 8 },
      ],
    });
  });
});

describe("checkOutDir", () => {
  const sourceDir = () => path.join(tmp, "workspace", "source");

  test("a new or empty dir, or a site built before, is fine", () => {
    expect(checkOutDir(path.join(tmp, "new"), { sourceDir: sourceDir() })).toBeNull();
    fs.mkdirSync(path.join(tmp, "empty"));
    write(path.join(tmp, "empty", ".git", "HEAD"));
    expect(checkOutDir(path.join(tmp, "empty"), { sourceDir: sourceDir() })).toBeNull();
    write(path.join(tmp, "built", "canvas.json"), "{}");
    write(path.join(tmp, "built", HASHED_FILES), "[]");
    expect(checkOutDir(path.join(tmp, "built"), { sourceDir: sourceDir() })).toBeNull();
  });

  test("a dir holding the app or the workspace, or anything else, is refused", () => {
    expect(checkOutDir(path.join(tmp, "workspace"), { sourceDir: sourceDir() })).toMatch(/holds the app or the workspace/);
    expect(checkOutDir(tmp, { appDir: path.join(tmp, "app"), sourceDir: "/elsewhere" })).toMatch(/holds the app/);
    write(path.join(tmp, "other", "notes.txt"));
    expect(checkOutDir(path.join(tmp, "other"), { sourceDir: sourceDir() })).toMatch(/is not a built site/);
  });
});

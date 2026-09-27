import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentType } from "../content-types.ts";
import { HASHED_FILES, listSiteFiles } from "../site-build.ts";

let site: string;

const write = (file: string, content = "") => {
  const full = path.join(site, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

beforeEach(() => {
  site = fs.mkdtempSync(path.join(os.tmpdir(), "site-files-"));
  write("preview.html", "<!doctype html><title>preview</title>");
  write("canvas.json", '{"version":1}');
  write("index.html", "<!doctype html><title>viewer</title>");
  write(
    HASHED_FILES,
    JSON.stringify(["assets/index-AbCdEf12.js", "assets/.Dot-AbC12345.js", "assets/logo-XyZ98765.png"]),
  );
  write("assets/index-AbCdEf12.js", "console.log(1)");
  write("assets/.Dot-AbC12345.js", "dot()");
  write("assets/logo-XyZ98765.png", "png");
  write("_antidraw/viewer-Qwerty12.js", "viewer()");
  write("_antidraw/viewer-Qwerty12.css", "body{}");
  write("robots.txt", "User-agent: *");
  write("clip.mp4", "mp4");
  write("data.bin", "bin");
  write(".well-known/security.txt", "Contact: x");
  write(".DS_Store", "");
  write("public/.env", "SECRET=1");
  write("a/.b/c", "");
});

afterEach(() => {
  fs.rmSync(site, { recursive: true, force: true });
});

describe("listSiteFiles", () => {
  test("skips hidden files, except .well-known/ and what the build emitted", async () => {
    const { files, skipped } = await listSiteFiles(site);
    expect(skipped).toEqual([".DS_Store", "a/.b/c", "public/.env"]);
    expect(files.map((f) => f.path)).toEqual([
      ".well-known/security.txt",
      "_antidraw/viewer-Qwerty12.css",
      "_antidraw/viewer-Qwerty12.js",
      "assets/.Dot-AbC12345.js",
      "assets/index-AbCdEf12.js",
      "assets/logo-XyZ98765.png",
      "clip.mp4",
      "data.bin",
      "robots.txt",
    ]);
  });

  test("marks the viewer's and the build's hashed files immutable, and nothing else", async () => {
    const { files, entries } = await listSiteFiles(site);
    const immutable = files.filter((f) => f.immutable).map((f) => f.path);
    expect(immutable).toEqual([
      "_antidraw/viewer-Qwerty12.css",
      "_antidraw/viewer-Qwerty12.js",
      "assets/.Dot-AbC12345.js",
      "assets/index-AbCdEf12.js",
      "assets/logo-XyZ98765.png",
    ]);
    expect(entries.every((f) => !f.immutable)).toBe(true);
  });

  test("gives each file its size, sha256 and content type", async () => {
    const { files, entries } = await listSiteFiles(site);
    const byPath = new Map([...files, ...entries].map((f) => [f.path, f]));

    expect(byPath.get("robots.txt")).toEqual({
      path: "robots.txt",
      size: "User-agent: *".length,
      sha256: sha256("User-agent: *"),
      contentType: "text/plain; charset=utf-8",
      immutable: false,
    });
    expect(byPath.get("assets/index-AbCdEf12.js")!.contentType).toBe("text/javascript; charset=utf-8");
    expect(byPath.get("clip.mp4")!.contentType).toBe("video/mp4");
    expect(byPath.get("data.bin")!.contentType).toBe("application/octet-stream");
    expect(byPath.get("canvas.json")!.contentType).toBe("application/json; charset=utf-8");
    expect(byPath.get("canvas.json")!.sha256).toBe(sha256('{"version":1}'));
    expect(byPath.get("index.html")!.contentType).toBe("text/html; charset=utf-8");
  });

  test("splits out the entries in upload order, and leaves out the hashed list", async () => {
    const { files, entries, skipped } = await listSiteFiles(site);
    expect(entries.map((f) => f.path)).toEqual(["preview.html", "canvas.json", "index.html"]);
    const all = [...files.map((f) => f.path), ...skipped];
    for (const name of ["preview.html", "canvas.json", "index.html", HASHED_FILES]) {
      expect(all).not.toContain(name);
    }
  });

  test("a site without one of the entries throws", async () => {
    fs.rmSync(path.join(site, "canvas.json"));
    await expect(listSiteFiles(site)).rejects.toThrow(/canvas\.json/);
  });

  test("symlinks are not listed", async () => {
    fs.symlinkSync(path.join(site, "robots.txt"), path.join(site, "link.txt"));
    const { files, skipped } = await listSiteFiles(site);
    expect([...files.map((f) => f.path), ...skipped]).not.toContain("link.txt");
  });
});

describe("contentType", () => {
  test("goes by extension, case-insensitively", () => {
    expect(contentType("a/B.PNG")).toBe("image/png");
    expect(contentType("site.webmanifest")).toBe("application/manifest+json");
    expect(contentType("noext")).toBe("application/octet-stream");
  });
});

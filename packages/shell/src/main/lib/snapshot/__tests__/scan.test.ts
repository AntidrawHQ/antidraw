import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { findCaseCollisions, isExcludedSnapshotPath, isSafeSnapshotPath } from "../paths";
import { scanWorkspace } from "../scan";
import { isSensitiveFile, type Exclusion, type SnapshotPlan } from "../types";
import { cleanupTmp, isCaseInsensitive, makeTmp, writeTree } from "./helpers";

// The workspace template's .gitignore
const TEMPLATE_GITIGNORE = "node_modules\ndist\n.DS_Store\n.vite\n*.log\n.env\n.env.local\n";

afterEach(cleanupTmp);

const scan = async (dir: string): Promise<SnapshotPlan> => {
  const result = await scanWorkspace(dir);
  if (result.isErr()) throw new Error(`scan failed: ${result.error.code} ${result.error.message}`);
  return result.value;
};

const paths = (plan: SnapshotPlan) => plan.files.map((f) => f.path);
const exclusion = (plan: SnapshotPlan, p: string): Exclusion | undefined =>
  plan.excluded.listed.find((e) => e.path === p);
const reasonOf = (plan: SnapshotPlan, p: string) => exclusion(plan, p)?.reason;

describe("isExcludedSnapshotPath (the table shared with the server)", () => {
  test.each([
    [".git/config", true],
    ["a/.Claude/x", true],
    ["node_modules/x", true],
    ["dist/x", true],
    ["src/dist/x", false],
    [".env.local", true],
    ["a/.npmrc", true],
    ["k/id_rsa", true],
    ["x.pem", true],
    [".aws/credentials", true],
    ["src/app.ts", false],
    ["dist", false],
    ["out/x", true],
    [".vite/deps/x.js", true],
    ["a/.DS_Store", true],
    ["a/.env.d/x", true],
    ["sub/.dev.vars.local", true],
    ["deck.key", false],
    // Names APFS case-folds onto a denylisted one (ſ → s, K → k), which toLowerCase misses
    ["node_module\u017f/x", true],
    [".\u017f\u017fh/id", true],
    ["a/.aw\u017f/credentials", true],
    [".dev.var\u017f", true],
    [".git-credential\u017f", true],
    ["k/id_r\u017fa", true],
    ["a/.DS_\u017ftore", true],
  ])("%s → %s", (p, excluded) => {
    expect(isExcludedSnapshotPath(p)).toBe(excluded);
  });

  test("the credential denylist, without *.key (Keynote files)", () => {
    for (const name of [".npmrc", ".YARNRC.yml", ".netrc", ".git-credentials", ".pypirc", "a.p12", "b.PFX", "id_dsa.pub", "id_ecdsa", "id_ed25519"]) {
      expect(isSensitiveFile(name), name).toBe(true);
    }
    expect(isSensitiveFile("slides.key")).toBe(false);
    expect(isSensitiveFile("README.md")).toBe(false);
  });

  test("findCaseCollisions groups by case and Unicode normalization", () => {
    const nfc = "caf\u00e9.txt";
    const nfd = "cafe\u0301.txt";
    expect(findCaseCollisions(["README.md", "src/a.ts", "Readme.md", nfc, nfd, "SRC/b.ts"])).toEqual([
      ["README.md", "Readme.md"],
      [nfd, nfc],
    ]);
  });

  test("findCaseCollisions folds like APFS (ſ = s, K = k, ß = ss)", () => {
    expect(findCaseCollisions(["s.txt", "\u017f.txt", "k.txt", "\u212A.txt", "stra\u00dfe", "STRASSE", "b.txt"])).toEqual([
      ["s.txt", "\u017f.txt"],
      ["k.txt", "\u212A.txt"],
      ["STRASSE", "stra\u00dfe"],
    ]);
  });

  test("isSafeSnapshotPath", () => {
    for (const p of ["", "/abs", "a/../b", "..", "./a", "a//b", "a/", "a\\b", "a\0b", "a\nb", "x".repeat(256)]) {
      expect(isSafeSnapshotPath(p), JSON.stringify(p)).toBe(false);
    }
    for (const p of ["a", "a/b.c", ".well-known/x", "é/ü.png", "x".repeat(255)]) {
      expect(isSafeSnapshotPath(p), p).toBe(true);
    }
    expect(isSafeSnapshotPath(Array(300).fill("abcd").join("/"))).toBe(false); // > 1024 bytes
  });
});

describe("scanWorkspace", () => {
  test("SOURCE_MISSING for a missing directory", async () => {
    const result = await scanWorkspace(path.join(makeTmp(), "nope"));
    expect(result._unsafeUnwrapErr().code).toBe("SOURCE_MISSING");
  });

  test("the template .gitignore excludes dist/, *.log and .env.local; .gitignore files and public/ are included", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": TEMPLATE_GITIGNORE,
      "package.json": "{}",
      "a.log": "log",
      ".env.local": "SECRET=1",
      "dist/index.html": "<html>",
      "public/logo.svg": "<svg/>",
      "src/app.ts": "export {}",
    });
    const plan = await scan(dir);
    expect(paths(plan)).toEqual([".gitignore", "package.json", "public/logo.svg", "src/app.ts"]);
    expect(exclusion(plan, "a.log")).toMatchObject({ reason: "gitignored", rule: "*.log", ignoreFile: ".gitignore" });
    expect(reasonOf(plan, ".env.local")).toBe("always-excluded");
    expect(reasonOf(plan, "dist/")).toBe("always-excluded");
  });

  test("rules match file names stored decomposed (NFD), as git's core.precomposeunicode does", async () => {
    const dir = makeTmp();
    const nfdFile = "cafe\u0301-secret.txt";
    const nfdDir = "re\u0301sume\u0301";
    writeTree(dir, {
      ".gitignore": "caf\u00e9-secret.txt\ndocs/r\u00e9sum\u00e9/\n",
      [nfdFile]: "secret",
      [`docs/${nfdDir}/cv.pdf`]: "cv",
      "docs/readme.md": "hi",
    });
    const names = fs.readdirSync(dir);
    // Skip where the filesystem normalizes names itself; the case under test is a stored NFD name
    if (!names.includes(nfdFile)) return;
    const plan = await scan(dir);
    expect(paths(plan)).toEqual([".gitignore", "docs/readme.md"]);
    expect(exclusion(plan, nfdFile)).toMatchObject({ reason: "gitignored", rule: "caf\u00e9-secret.txt" });
    expect(reasonOf(plan, `docs/${nfdDir}/`)).toBe("gitignored");
  });

  test("a nested .gitignore re-includes with !, and ignored directories are not descended into", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": `${TEMPLATE_GITIGNORE}build/\n`,
      "sub/.gitignore": "!keep.log\n",
      "sub/keep.log": "kept",
      "sub/drop.log": "dropped",
      "build/.gitignore": "!*\n",
      "build/out.js": "x",
    });
    const plan = await scan(dir);
    expect(paths(plan)).toContain("sub/keep.log");
    expect(paths(plan)).toContain("sub/.gitignore");
    expect(paths(plan)).not.toContain("sub/drop.log");
    expect(exclusion(plan, "build/")).toMatchObject({ isDir: true, reason: "gitignored", rule: "build/" });
    // build/.gitignore could only take effect if the walk had entered build/
    expect(plan.excluded.listed.some((e) => e.path.startsWith("build/") && e.path !== "build/")).toBe(false);
    expect(paths(plan).some((p) => p.startsWith("build/"))).toBe(false);
  });

  test("a deeper .gitignore that re-includes a directory decides its children too (git precedence)", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": "dist\n",
      "pkg/.gitignore": "!dist/\n",
      "pkg/dist/x.js": "x",
      "other/dist/y.js": "y",
    });
    const plan = await scan(dir);
    expect(paths(plan)).toContain("pkg/dist/x.js");
    expect(reasonOf(plan, "other/dist/")).toBe("gitignored");
  });

  test("always-excludes win over ! rules", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": `${TEMPLATE_GITIGNORE}!node_modules\n!dist\n!.env.production\n!.npmrc\n`,
      ".env.production": "SECRET=1",
      ".git/config": "[core]",
      ".claude/settings.json": "{}",
      ".vercel/project.json": "{}",
      "node_modules/pkg/index.js": "x",
      "out/main.js": "x",
      "dist/index.html": "x",
      ".vite/deps/x.js": "x",
      "sub/.DS_Store": "x",
      "src/app.ts": "x",
    });
    const plan = await scan(dir);
    expect(paths(plan)).toEqual([".gitignore", "src/app.ts"]);
    for (const p of [".env.production", ".git/", ".claude/", ".vercel/", "node_modules/", "out/", "dist/", ".vite/", "sub/.DS_Store"]) {
      expect(reasonOf(plan, p), p).toBe("always-excluded");
    }
  });

  test("dist/, out/ and .vite/ are always-excluded at the root only", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": TEMPLATE_GITIGNORE,
      "src/lib/out/x.ts": "x",
      "pkg/dist/x.js": "x",
      out: "a root file named out",
    });
    const plan = await scan(dir);
    expect(paths(plan)).toContain("src/lib/out/x.ts");
    expect(paths(plan)).toContain("out");
    expect(exclusion(plan, "pkg/dist/")).toMatchObject({ reason: "gitignored", rule: "dist" });

    fs.appendFileSync(path.join(dir, ".gitignore"), "!pkg/dist\n");
    expect(paths(await scan(dir))).toContain("pkg/dist/x.js");
  });

  test("secrets are listed as secret and ! cannot re-include them", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": "!.npmrc\n",
      ".npmrc": "//registry/:_authToken=x",
      "sub/.dev.vars": "X=1",
      id_ed25519: "key",
      "certs/a.pem": "pem",
      ".aws/credentials": "creds",
      ".ssh/config": "x",
      "slides.key": "keynote",
    });
    const plan = await scan(dir);
    for (const p of [".npmrc", "sub/.dev.vars", "id_ed25519", "certs/a.pem"]) expect(reasonOf(plan, p), p).toBe("secret");
    expect(reasonOf(plan, ".aws/")).toBe("secret");
    expect(reasonOf(plan, ".ssh/")).toBe("secret");
    expect(paths(plan)).toEqual([".gitignore", "slides.key"]);
  });

  test("symlinks: inside, outside, to excluded files, to directories, broken", async () => {
    const outside = makeTmp();
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": `${TEMPLATE_GITIGNORE}y/\n`,
      "src/real.txt": "real content",
      "inside.txt": { symlink: "src/real.txt" },
      "outside.txt": { symlink: path.join(outside, "secret.txt") },
      ".env": "SECRET=1",
      "env-link": { symlink: ".env" },
      "dir-link": { symlink: "src" },
      "broken": { symlink: "nowhere.txt" },
      ".git/config": "[core]",
      "notes.txt": { symlink: ".git/config" },
      ".claude/settings.local.json": "{}",
      "x.json": { symlink: ".claude/settings.local.json" },
      "node_modules/pkg/index.js": "x",
      k: { symlink: "node_modules/pkg/index.js" },
      // z/ is walked after a/, and its .gitignore is read on demand
      "a/link": { symlink: "../z/secret.txt" },
      "z/.gitignore": "secret.txt\n",
      "z/secret.txt": "ignored",
      "a/link2": { symlink: "../y/file.txt" },
      "y/file.txt": "in an ignored directory",
    });
    const plan = await scan(dir);

    const inside = plan.files.find((f) => f.path === "inside.txt");
    expect(inside).toMatchObject({ viaSymlink: true, absPath: path.join(dir, "src/real.txt"), size: 12 });
    expect(inside?.ino).toBe(fs.statSync(path.join(dir, "src/real.txt")).ino);

    expect(reasonOf(plan, "outside.txt")).toBe("symlink-outside");
    expect(reasonOf(plan, "env-link")).toBe("symlink-to-excluded");
    expect(reasonOf(plan, "dir-link")).toBe("symlink-directory");
    expect(reasonOf(plan, "broken")).toBe("symlink-broken");
    for (const p of ["notes.txt", "x.json", "k", "a/link", "a/link2"]) {
      expect(reasonOf(plan, p), p).toBe("symlink-to-excluded");
    }
    expect(paths(plan)).toEqual([".gitignore", "inside.txt", "src/real.txt", "z/.gitignore"]);
  });

  test.skipIf(process.platform === "win32")("a FIFO is not-a-regular-file", async () => {
    const dir = makeTmp();
    execFileSync("mkfifo", [path.join(dir, "pipe")]);
    const plan = await scan(dir);
    expect(reasonOf(plan, "pipe")).toBe("not-a-regular-file");
    expect(plan.files).toEqual([]);
  });

  test("the exec bit and inode are recorded", async () => {
    const dir = makeTmp();
    writeTree(dir, { "run.sh": { content: "#!/bin/sh", mode: 0o755 }, "a.txt": { content: "a", mode: 0o600 } });
    const plan = await scan(dir);
    expect(plan.files.map((f) => [f.path, f.mode])).toEqual([
      ["a.txt", 0o644],
      ["run.sh", 0o755],
    ]);
    const stats = fs.statSync(path.join(dir, "run.sh"));
    expect(plan.files[1]).toMatchObject({ dev: stats.dev, ino: stats.ino, viaSymlink: false });
  });

  test("files are sorted by UTF-8 bytes", async () => {
    const dir = makeTmp();
    writeTree(dir, { b: "", "a/z": "", "a.b": "", C: "", é: "", "a-b": "", "~": "" });
    const plan = await scan(dir);
    expect(paths(plan)).toEqual(["C", "a-b", "a.b", "a/z", "b", "~", "é"]);
    const sorted = [...paths(plan)].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
    expect(paths(plan)).toEqual(sorted);
  });

  test("names that differ only by case are a CASE_COLLISION", async (ctx) => {
    const dir = makeTmp();
    if (isCaseInsensitive(dir)) ctx.skip();
    writeTree(dir, { "README.md": "a", "Readme.md": "b", "src/x.ts": "" });
    const result = await scanWorkspace(dir);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("CASE_COLLISION");
    expect(error.paths).toEqual([["README.md", "Readme.md"]]);
  });

  test("unsupported names are listed", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const dir = makeTmp();
    writeTree(dir, { "ok.txt": "", "bad\nname.txt": "", "back\\slash": "" });
    const plan = await scan(dir);
    expect(paths(plan)).toEqual(["ok.txt"]);
    expect(reasonOf(plan, "bad\nname.txt")).toBe("unsupported-name");
    expect(reasonOf(plan, "back\\slash")).toBe("unsupported-name");
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("unreadable files and directories", async () => {
    const dir = makeTmp();
    writeTree(dir, { "locked.txt": "x", "closed/a.txt": "x", "ok.txt": "x" });
    fs.chmodSync(path.join(dir, "locked.txt"), 0o000);
    fs.chmodSync(path.join(dir, "closed"), 0o000);
    try {
      const plan = await scan(dir);
      expect(paths(plan)).toEqual(["ok.txt"]);
      expect(reasonOf(plan, "locked.txt")).toBe("unreadable");
      expect(exclusion(plan, "closed/")).toMatchObject({ isDir: true, reason: "unreadable" });
    } finally {
      fs.chmodSync(path.join(dir, "closed"), 0o755);
    }
  });

  test("more than 20 gitignored files for one rule collapse into a group", async () => {
    const dir = makeTmp();
    const tree: Record<string, string> = { ".gitignore": "*.log\n*.tmp\n" };
    for (let i = 0; i < 25; i++) tree[`logs/${String(i).padStart(2, "0")}.log`] = "";
    for (let i = 0; i < 3; i++) tree[`t${i}.tmp`] = "";
    writeTree(dir, tree);
    const plan = await scan(dir);
    expect(plan.excluded.grouped).toEqual([
      {
        reason: "gitignored",
        ignoreFile: ".gitignore",
        rule: "*.log",
        count: 25,
        examples: ["logs/00.log", "logs/01.log", "logs/02.log", "logs/03.log", "logs/04.log"],
      },
    ]);
    expect(plan.excluded.listed.map((e) => e.path)).toEqual(["t0.tmp", "t1.tmp", "t2.tmp"]);
  });

  test("every exclusion appears in the report", async () => {
    const dir = makeTmp();
    writeTree(dir, {
      ".gitignore": TEMPLATE_GITIGNORE,
      ".env": "x",
      ".npmrc": "x",
      "a.log": "x",
      "node_modules/x/index.js": "x",
      "gone": { symlink: "missing" },
      "src/a.ts": "x",
    });
    const plan = await scan(dir);
    const reported = [...plan.excluded.listed.map((e) => e.path), ...plan.excluded.grouped.flatMap((g) => g.examples)];
    expect(reported.sort()).toEqual([".env", ".npmrc", "a.log", "gone", "node_modules/"]);
  });

  test("an aborted signal gives CANCELLED", async () => {
    const dir = makeTmp();
    writeTree(dir, { "a.txt": "" });
    const controller = new AbortController();
    controller.abort();
    const result = await scanWorkspace(dir, { signal: controller.signal });
    expect(result._unsafeUnwrapErr().code).toBe("CANCELLED");
  });
});

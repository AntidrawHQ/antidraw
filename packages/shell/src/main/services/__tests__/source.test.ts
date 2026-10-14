import { execFileSync } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, describe, expect, it } from "vitest";
import {
  batches,
  changedSince,
  commitSource,
  initSource,
  listSource,
  saveSource,
  sourceProblem,
  SourceMovedError,
  type SourceFile,
  type SourceRemote,
} from "../source";

// The workspace's source as commits, on disk with isomorphic-git; pushing to
// the site's repo is faked (SourceRemote), as git's own side isn't ours to test.

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

const tmp = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-source-"));
  dirs.push(dir);
  return dir;
};

/** A folder with these files; null makes an empty folder. */
const folder = async (files: Record<string, string | null>) => {
  const dir = await tmp();
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    if (content === null) {
      await fs.mkdir(full, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return dir;
};

const repo = async () => {
  const gitDir = await tmp();
  await initSource(gitDir);
  return gitDir;
};

/** A commit's files, path → content (or mode, when not a plain file). */
const filesAt = async (gitDir: string, commit: string) => {
  const files: Record<string, string> = {};
  const walk = async (oid: string, prefix: string) => {
    for (const entry of (await git.readTree({ fs: nodeFs, gitdir: gitDir, oid })).tree) {
      if (entry.type === "tree") {
        await walk(entry.oid, `${prefix}${entry.path}/`);
        continue;
      }
      const { blob } = await git.readBlob({ fs: nodeFs, gitdir: gitDir, oid: entry.oid });
      const text = Buffer.from(blob).toString();
      files[prefix + entry.path] = entry.mode === "100644" ? text : `${entry.mode} ${text}`;
    }
  };
  await walk((await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit })).commit.tree, "");
  return files;
};

/** Commits everything in dir, as a publish does. */
const commitAll = async (dir: string, gitDir: string, parent: string | null, message = "Publish") =>
  commitSource({ sourceDir: dir, gitDir, files: await listSource(dir), parent, message, now: 0 });

const message = async (gitDir: string, commit: string) =>
  (await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit })).commit.message.trim();

describe("listSource", () => {
  it("leaves out what .gitignore files and the fixed list leave out, and keeps modes", async () => {
    const dir = await folder({
      ".gitignore": "secret.txt\nbuild/\n*.log\n!keep.log\n",
      "src/App.tsx": "app",
      "src/.gitignore": "generated/\n!secret.txt\n",
      "src/generated/types.ts": "x",
      "src/secret.txt": "re-included by src/.gitignore",
      "secret.txt": "ignored",
      "build/out.js": "x",
      "debug.log": "x",
      "keep.log": "x",
      "node_modules/react/index.js": "x",
      "dist/index.html": "x",
      "out/video.mp4": "x",
      ".vite/deps.json": "x",
      ".env": "x",
      ".env.local": "x",
      ".dev.vars": "x",
      ".DS_Store": "x",
      "certs/server.pem": "x",
      "certs/server.key": "x",
      ".ssh/id_ed25519": "x",
      ".git/HEAD": "the user's own repo",
      "public/empty": null,
      "scripts/run.sh": "#!/bin/sh",
    });
    await fs.chmod(path.join(dir, "scripts/run.sh"), 0o755);
    await fs.symlink("src/App.tsx", path.join(dir, "link.tsx"));
    const files = await listSource(dir);
    expect(files.map(({ path, mode }) => `${mode} ${path}`)).toMatchInlineSnapshot(`
      [
        "100644 .gitignore",
        "100644 keep.log",
        "120000 link.tsx",
        "100755 scripts/run.sh",
        "100644 src/.gitignore",
        "100644 src/App.tsx",
        "100644 src/secret.txt",
      ]
    `);
  });

  it("leaves out a .git file, which a submodule or worktree has instead of the folder", async () => {
    const dir = await folder({
      ".git": "gitdir: /Users/someone/project/.git/worktrees/site",
      "vendor/lib/.git": "gitdir: ../../.git/modules/lib",
      "vendor/lib/index.ts": "lib",
    });
    expect((await listSource(dir)).map((file) => file.path)).toEqual(["vendor/lib/index.ts"]);
  });
});

describe("sourceProblem", () => {
  const file = (path: string, mb: number): SourceFile => ({ path, size: mb * 1024 * 1024, mtimeMs: 0, mode: "100644" });

  it("names the files over the per-file limit, biggest first", () => {
    const files = [
      file("src/App.tsx", 0.01),
      file("public/a.mov", 40),
      file("public/b.mp4", 3200),
      file("public/c.png", 32),
    ];
    expect(sourceProblem(files)).toMatchInlineSnapshot(`
      {
        "code": "FILE_TOO_LARGE",
        "message": "2 files are too big to publish. Each file can be up to 32 MB:
        public/b.mp4 (3.1 GB)
        public/a.mov (40 MB)
      Delete them or add them to .gitignore, then publish again.",
      }
    `);
  });

  it("names the biggest files when they add up to too much", () => {
    const files = Array.from({ length: 40 }, (_, index) => file(`public/clip-${index}.mp4`, 30 - index / 10));
    expect(sourceProblem(files)).toMatchInlineSnapshot(`
      {
        "code": "SOURCE_TOO_LARGE",
        "message": "This workspace's files add up to 1.1 GB, and a published workspace can be up to 1 GB. The biggest:
        public/clip-0.mp4 (30 MB)
        public/clip-1.mp4 (30 MB)
        public/clip-2.mp4 (30 MB)
        public/clip-3.mp4 (30 MB)
        public/clip-4.mp4 (30 MB)
      Delete files you don't need or add them to .gitignore, then publish again.",
      }
    `);
  });

  it("has nothing to say up to the limits", () => {
    const files = [file("public/a.mov", 32), ...Array.from({ length: 31 }, (_, i) => file(`p/${i}`, 32))];
    expect(sourceProblem(files)).toBeNull();
  });
});

it("changedSince names files edited or removed since they were listed, not new ones", async () => {
  const dir = await folder({ "a.ts": "a", "b.ts": "b", "c.ts": "c" });
  const files = await listSource(dir);
  await fs.writeFile(path.join(dir, "a.ts"), "a, edited");
  await fs.rm(path.join(dir, "b.ts"));
  await fs.writeFile(path.join(dir, "new.ts"), "new");
  expect(await changedSince(dir, files)).toEqual(["a.ts", "b.ts"]);
});

it("batches fills each push up to the limit, in order, and sends a too-big blob alone", () => {
  const sizes = [10, 10, 5, 30, 1, 1, 25];
  expect(batches(sizes.map((size, index) => ({ name: String.fromCharCode(97 + index), size })), 25).map((group) =>
    group.map(({ name, size }) => `${name}:${size}`).join(" "),
  )).toMatchInlineSnapshot(`
    [
      "a:10 b:10 c:5",
      "d:30",
      "e:1 f:1",
      "g:25",
    ]
  `);
});

describe("commitSource", () => {
  it("commits the files into the bare repo and leaves the workspace alone", async () => {
    const dir = await folder({ "src/App.tsx": "app", "index.html": "<html>", "src/lib/util.ts": "util" });
    await fs.symlink("index.html", path.join(dir, "home.html"));
    const gitDir = await repo();
    const { commits, head } = await commitAll(dir, gitDir, null);
    expect({
      commits: commits.length,
      head: head === commits[0],
      message: await message(gitDir, head!),
      files: await filesAt(gitDir, head!),
      workspace: (await fs.readdir(dir)).sort(),
    }).toMatchInlineSnapshot(`
      {
        "commits": 1,
        "files": {
          "home.html": "120000 index.html",
          "index.html": "<html>",
          "src/App.tsx": "app",
          "src/lib/util.ts": "util",
        },
        "head": true,
        "message": "Publish",
        "workspace": [
          "home.html",
          "index.html",
          "src",
        ],
      }
    `);
  });

  it("makes no commit when nothing changed, and answers the parent", async () => {
    const dir = await folder({ "a.ts": "a" });
    const gitDir = await repo();
    const files = await listSource(dir);
    const first = await commitSource({ sourceDir: dir, gitDir, files, parent: null, message: "Publish" });
    const again = await commitSource({ sourceDir: dir, gitDir, files, parent: first.head, message: "Publish" });
    expect(again).toEqual({ commits: [], head: first.head });
  });

  it("adds new files a push's worth at a time, the last commit being the whole snapshot", async () => {
    const dir = await folder({ "keep.ts": "kept", "gone.ts": "removed later", "edit.ts": "v1" });
    const gitDir = await repo();
    const parent = (await commitAll(dir, gitDir, null)).head;

    await fs.rm(path.join(dir, "gone.ts"));
    await fs.writeFile(path.join(dir, "edit.ts"), "v2 (10 b)");
    await fs.writeFile(path.join(dir, "a.bin"), "a".repeat(10));
    await fs.writeFile(path.join(dir, "b.bin"), "b".repeat(10));
    await fs.writeFile(path.join(dir, "copy.bin"), "a".repeat(10)); // the same blob as a.bin
    const { commits, head } = await commitSource({
      sourceDir: dir,
      gitDir,
      files: await listSource(dir),
      parent,
      message: "Publish",
      maxPushBytes: 20,
    });
    const history = await Promise.all(
      commits.map(async (commit) => ({
        message: await message(gitDir, commit),
        parent: (await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit })).commit.parent,
        files: await filesAt(gitDir, commit),
      })),
    );
    expect(head).toBe(commits.at(-1));
    expect(JSON.parse(JSON.stringify(history).replaceAll(parent!, "<parent>").replaceAll(commits[0]!, "<part 1>")))
      .toMatchInlineSnapshot(`
        [
          {
            "files": {
              "a.bin": "aaaaaaaaaa",
              "b.bin": "bbbbbbbbbb",
              "edit.ts": "v1",
              "gone.ts": "removed later",
              "keep.ts": "kept",
            },
            "message": "Publish (part 1 of 2)",
            "parent": [
              "<parent>",
            ],
          },
          {
            "files": {
              "a.bin": "aaaaaaaaaa",
              "b.bin": "bbbbbbbbbb",
              "copy.bin": "aaaaaaaaaa",
              "edit.ts": "v2 (10 b)",
              "keep.ts": "kept",
            },
            "message": "Publish (part 2 of 2)",
            "parent": [
              "<part 1>",
            ],
          },
        ]
      `);
  });

  it("keeps each part a valid tree when a file becomes a folder or a folder a file", async () => {
    const dir = await folder({ config: "a file", "lib/a.ts": "a", "lib/b/c.ts": "c" });
    const gitDir = await repo();
    const parent = (await commitAll(dir, gitDir, null)).head;

    await fs.rm(path.join(dir, "config"));
    await fs.rm(path.join(dir, "lib"), { recursive: true });
    await fs.mkdir(path.join(dir, "config"));
    await fs.writeFile(path.join(dir, "config/app.json"), "x".repeat(10));
    await fs.writeFile(path.join(dir, "lib"), "y".repeat(10));
    await fs.writeFile(path.join(dir, "z.bin"), "z".repeat(10));
    const { commits } = await commitSource({
      sourceDir: dir,
      gitDir,
      files: await listSource(dir),
      parent,
      message: "Publish",
      maxPushBytes: 10,
    });
    // git itself refuses a tree with two entries of one name.
    execFileSync("git", ["--git-dir", gitDir, "fsck", "--strict", "--no-dangling"], { stdio: "pipe" });
    expect(await Promise.all(commits.map((commit) => filesAt(gitDir, commit)))).toMatchInlineSnapshot(`
      [
        {
          "config/app.json": "xxxxxxxxxx",
          "lib/a.ts": "a",
          "lib/b/c.ts": "c",
        },
        {
          "config/app.json": "xxxxxxxxxx",
          "lib": "yyyyyyyyyy",
        },
        {
          "config/app.json": "xxxxxxxxxx",
          "lib": "yyyyyyyyyy",
          "z.bin": "zzzzzzzzzz",
        },
      ]
    `);
  });
});

describe("saveSource", () => {
  /** A repo whose main moves under the first `moves` pushes, as another publish's push would. */
  const remote = (gitDir: string, dir: string, moves: number) => {
    let head: string | null = null;
    const pushed: string[] = [];
    let moved = 0;
    const self: SourceRemote & { pushed: string[] } = {
      pushed,
      head: async () => head,
      async push(commit) {
        if (moved < moves) {
          moved++;
          // Someone else's commit, already fetched.
          await fs.writeFile(path.join(dir, "theirs.ts"), `theirs ${moved}`);
          head = (await commitAll(dir, gitDir, head, "Theirs")).head;
          await fs.rm(path.join(dir, "theirs.ts"));
          throw new SourceMovedError("not-fast-forward");
        }
        pushed.push(commit);
        head = commit;
      },
    };
    return self;
  };

  it("builds on what another publish pushed in between, once", async () => {
    const dir = await folder({ "a.ts": "a" });
    const gitDir = await repo();
    const repoRemote = remote(gitDir, dir, 1);
    const files = await listSource(dir);
    const commit = await saveSource({ sourceDir: dir, gitDir, files, remote: repoRemote, message: "Publish" });
    const { parent } = (await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit })).commit;
    expect({
      pushed: repoRemote.pushed.length,
      answered: repoRemote.pushed[0] === commit,
      onTheirs: (await message(gitDir, parent[0]!)) === "Theirs",
      files: await filesAt(gitDir, commit),
    }).toMatchInlineSnapshot(`
      {
        "answered": true,
        "files": {
          "a.ts": "a",
        },
        "onTheirs": true,
        "pushed": 1,
      }
    `);
  });

  it("gives up when it moves again", async () => {
    const dir = await folder({ "a.ts": "a" });
    const gitDir = await repo();
    const files = await listSource(dir);
    const saving = saveSource({ sourceDir: dir, gitDir, files, remote: remote(gitDir, dir, 2), message: "Publish" });
    await expect(saving).rejects.toBeInstanceOf(SourceMovedError);
  });
});

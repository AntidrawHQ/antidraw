import { execFileSync } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import git from "isomorphic-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { batches, commitSource, initSource, listSource } from "../source";

// The source as commits and the files it's made of, against git itself:
// whatever a workspace was and becomes (files moved, copied, deleted, made
// folders or folders made files, modes changed), the last commit is exactly
// the workspace, every part is a tree git accepts, each push stays in budget,
// and a publish that stopped partway picks up where it left off; and the
// files listed are those git would take.

const MAX_PUSH = 64;

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-source-property-"));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const run = () => fs.mkdtemp(path.join(root, "run-"));

// git as the user has none of it set up.
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const gitCli = (args: string[]) => execFileSync("git", args, { env, stdio: "pipe" }).toString();

type Mode = "100644" | "100755" | "120000";
type Workspace = Map<string, { mode: Mode; content: Uint8Array }>;

/** Keeps the first of paths that would be a file and a folder at once. */
const workspace = (entries: [string, { mode: Mode; content: Uint8Array }][]): Workspace => {
  const files: Workspace = new Map();
  for (const [file, entry] of entries) {
    const clash = [...files.keys()].some((other) => other === file || other.startsWith(`${file}/`) || file.startsWith(`${other}/`));
    if (!clash) files.set(file, entry);
  }
  return files;
};

const write = async (dir: string, files: Workspace) => {
  await fs.mkdir(dir, { recursive: true });
  for (const [file, { mode, content }] of files) {
    const full = path.join(dir, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (mode === "120000") {
      await fs.symlink(Buffer.from(content).toString(), full);
      continue;
    }
    await fs.writeFile(full, content);
    if (mode === "100755") await fs.chmod(full, 0o755);
  }
};

// A tiny alphabet, so `a`, `a/b` and `a/b/c` are all paths and clash; a few
// contents shared, so blobs move and are copied, one over the budget.
const text = (value: string) => new TextEncoder().encode(value);
const SHARED = [text(""), text("x"), text("a".repeat(30)), text("c".repeat(40)), text("b".repeat(70))];
const segments = fc.array(fc.constantFrom("a", "b", "c"), { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"));
const content = fc.oneof(fc.constantFrom(...SHARED), fc.uint8Array({ maxLength: 80 }));
const target = fc.oneof(fc.constantFrom("x", "a", "../b"), fc.stringMatching(/^[a-c./]{1,12}$/)).map(text);
const entry = fc.oneof(
  { weight: 3, arbitrary: fc.record({ mode: fc.constant<Mode>("100644"), content }) },
  { weight: 1, arbitrary: fc.record({ mode: fc.constant<Mode>("100755"), content }) },
  { weight: 1, arbitrary: fc.record({ mode: fc.constant<Mode>("120000"), content: target }) },
);
const entries = fc.array(fc.tuple(segments, entry), { maxLength: 8 });

/** What the workspace was at the last publish, and is now: some of it moved, some kept, some new. */
const change = fc
  .record({
    before: entries,
    after: entries,
    moves: fc.array(fc.option(segments, { nil: undefined }), { minLength: 8, maxLength: 8 }),
    keep: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  })
  .map(({ before, after, moves, keep }) => ({
    previous: workspace(before),
    next: workspace([
      ...before.flatMap(([, entry], index): typeof before => (moves[index] ? [[moves[index], entry]] : [])),
      ...after,
      ...before.filter((_, index) => keep[index]),
    ]),
  }));

const show = ({ previous, next }: { previous: Workspace; next: Workspace }) => {
  const list = (files: Workspace) =>
    Object.fromEntries([...files].map(([file, { mode, content }]) => [file, `${mode} ${JSON.stringify(Buffer.from(content).toString("latin1"))}`]));
  return JSON.stringify({ previous: list(previous), next: list(next) });
};

/** Publishes previous on an empty repo, then next on top, both in pushes of MAX_PUSH. */
const publish = async ({ previous, next }: { previous: Workspace; next: Workspace }) => {
  const dir = await run();
  const gitDir = path.join(dir, "git");
  await initSource(gitDir);
  await write(path.join(dir, "previous"), previous);
  await write(path.join(dir, "next"), next);
  const commit = async (name: string, parent: string | null) => {
    const sourceDir = path.join(dir, name);
    return commitSource({ sourceDir, gitDir, files: await listSource(sourceDir), parent, message: name, maxPushBytes: MAX_PUSH, now: 0 });
  };
  const first = await commit("previous", null);
  const second = await commit("next", first.head);
  return { gitDir, first, second, again: (parent: string) => commit("next", parent) };
};

type Tree = Map<string, { mode: string; oid: string; size: number }>;

/** A commit's files as git lists them. */
const treeOf = (gitDir: string, commit: string): Tree => {
  const out = gitCli(["--git-dir", gitDir, "ls-tree", "-r", "-l", "-z", "--full-tree", commit]);
  const tree: Tree = new Map();
  for (const line of out.split("\0").filter(Boolean)) {
    const [meta = "", file = ""] = line.split("\t");
    const [mode = "", , oid = "", size = ""] = meta.split(/ +/);
    tree.set(file, { mode, oid, size: Number(size) });
  }
  return tree;
};

/** The same, read in process: quicker for the commits in between. */
const filesOf = async (gitDir: string, commit: string, cache: object): Promise<Tree> => {
  const tree: Tree = new Map();
  const walk = async (oid: string, prefix: string) => {
    for (const entry of (await git.readTree({ fs: nodeFs, gitdir: gitDir, oid, cache })).tree) {
      if (entry.type === "tree") await walk(entry.oid, `${prefix}${entry.path}/`);
      else {
        const { blob } = await git.readBlob({ fs: nodeFs, gitdir: gitDir, oid: entry.oid, cache });
        tree.set(prefix + entry.path, { mode: entry.mode, oid: entry.oid, size: blob.length });
      }
    }
  };
  await walk((await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit, cache })).commit.tree, "");
  return tree;
};

const expected = async (files: Workspace): Promise<Tree> => {
  const tree: Tree = new Map();
  for (const [file, { mode, content }] of files) {
    tree.set(file, { mode, oid: (await git.hashBlob({ object: content })).oid, size: content.length });
  }
  return tree;
};

const sorted = (tree: Tree) => [...tree].map(([file, { mode, oid }]) => `${mode} ${oid} ${file}`).sort();

/** The blobs a push of `tree` onto `before` sends: those not in before's tree. */
const sent = (tree: Tree, before: Tree | null) => {
  const had = new Set([...(before?.values() ?? [])].map(({ oid }) => oid));
  const blobs = new Map<string, number>();
  for (const { oid, size } of tree.values()) if (!had.has(oid)) blobs.set(oid, size);
  return blobs;
};

const parentOf = async (gitDir: string, commit: string) =>
  (await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit })).commit.parent;

describe("commitSource", () => {
  it("ends at exactly the workspace, every part a tree git accepts", async () => {
    await fc.assert(
      fc.asyncProperty(change, async (change) => {
        const { gitDir, first, second } = await publish(change);
        expect(sorted(treeOf(gitDir, second.head!))).toEqual(sorted(await expected(change.next)));
        expect(sorted(treeOf(gitDir, first.head!))).toEqual(sorted(await expected(change.previous)));
        gitCli(["--git-dir", gitDir, "fsck", "--strict", "--no-dangling", ...first.commits, ...second.commits]);
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it("sends at most a push's worth of new blobs in each commit, or one bigger blob alone", async () => {
    await fc.assert(
      fc.asyncProperty(change, async (change) => {
        const { gitDir, first, second } = await publish(change);
        const cache = {};
        let before: Tree | null = null;
        for (const commit of [...first.commits, ...second.commits]) {
          const tree = await filesOf(gitDir, commit, cache);
          const blobs = sent(tree, before);
          const bytes = [...blobs.values()].reduce((sum, size) => sum + size, 0);
          if (blobs.size > 1) expect(bytes, show(change)).toBeLessThanOrEqual(MAX_PUSH);
          before = tree;
        }
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it("chains its commits, picks up after any of them, and has nothing to add after the last", async () => {
    await fc.assert(
      fc.asyncProperty(change, fc.nat(), async (change, stop) => {
        const { gitDir, first, second, again } = await publish(change);
        // A chain from the parent.
        let parent = first.head!;
        for (const commit of second.commits) {
          expect(await parentOf(gitDir, commit)).toEqual([parent]);
          parent = commit;
        }
        expect(second.head).toBe(second.commits.at(-1) ?? first.head);
        // Nothing new on its own head.
        expect(await again(second.head!)).toEqual({ commits: [], head: second.head });

        // Stopped after k of them: the rest, each new blob sent once.
        const k = stop % (second.commits.length + 1);
        const resumeFrom = k === 0 ? first.head! : second.commits[k - 1]!;
        const resumed = await again(resumeFrom);
        if (k === second.commits.length) {
          expect(resumed).toEqual({ commits: [], head: second.head });
          return;
        }
        const cache = {};
        const final = await filesOf(gitDir, resumed.head!, cache);
        expect(sorted(final)).toEqual(sorted(await filesOf(gitDir, second.head!, cache)));
        let before = await filesOf(gitDir, resumeFrom, cache);
        const remaining = sent(final, before);
        const introduced: string[] = [];
        for (const commit of resumed.commits) {
          const tree = await filesOf(gitDir, commit, cache);
          introduced.push(...sent(tree, before).keys());
          before = tree;
        }
        expect(introduced.sort(), show(change)).toEqual([...remaining.keys()].sort());
      }),
      { numRuns: 60 },
    );
  }, 60_000);
});

it("batches keeps every blob in order, in groups within the limit unless alone", () => {
  fc.assert(
    fc.property(fc.array(fc.nat(100)), fc.integer({ min: 1, max: 100 }), (sizes, max) => {
      const blobs = sizes.map((size, index) => ({ index, size }));
      const groups = batches(blobs, max);
      expect(groups.flat()).toEqual(blobs);
      for (const group of groups) {
        expect(group.length).toBeGreaterThan(0);
        const bytes = group.reduce((sum, { size }) => sum + size, 0);
        if (group.length > 1) expect(bytes).toBeLessThanOrEqual(max);
      }
    }),
    { numRuns: 500 },
  );
});

describe("listSource", () => {
  // Names on the fixed list and not, and rules that try to bring back what
  // it leaves out.
  const NAMES = ["a", "b", "c", "x", "node_modules", "dist", "out", ".vite", ".env", ".env.local", ".dev.vars", ".DS_Store", "x.pem", "x.key", "id_rsa", "id_ed25519.pub", ".git"];
  const RULES = [
    "a", "b/", "/c", "x", "*", "*.key", "**/b", "a/b", "c/*",
    "!a", "!b/", "!x", "!c", "!.env", "!.env*", "!.env.local", "!.git", "!.git/", "!node_modules/", "!node_modules",
    "!dist/", "!out", "!.vite/", "!*.pem", "!x.pem", "!x.key", "!id_rsa", "!id_ed25519.pub", "!.DS_Store", "!.dev.vars",
    "!*", "!**/node_modules/**", "!/dist/", "!**",
  ];

  /** Whether a path is on the fixed list: its name, or a folder it's in. */
  const fixed = (file: string) => {
    const parts = file.split("/");
    return parts.some(
      (name, index) =>
        (index < parts.length - 1 && ["node_modules", "dist", "out", ".vite"].includes(name)) ||
        name === ".git" ||
        name.startsWith(".env") ||
        name === ".dev.vars" ||
        name === ".DS_Store" ||
        /\.(pem|key)$/.test(name) ||
        /^id_(rsa|ed25519)/.test(name),
    );
  };

  const workspaceOf = (names: string[]) => {
    const file = fc.array(fc.constantFrom(...names), { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"));
    const gitignore = fc.tuple(
      fc.array(fc.constantFrom(...names), { maxLength: 2 }),
      fc.array(fc.constantFrom(...RULES), { minLength: 1, maxLength: 5 }),
    );
    return fc
      .record({ files: fc.array(file, { maxLength: 12 }), gitignores: fc.array(gitignore, { maxLength: 3 }) })
      .map(({ files, gitignores }) =>
        workspace([
          ...gitignores.map(([dir, rules]): [string, { mode: Mode; content: Uint8Array }] => [
            [...dir, ".gitignore"].join("/"),
            { mode: "100644", content: text(`${rules.join("\n")}\n`) },
          ]),
          ...files.map((file): [string, { mode: Mode; content: Uint8Array }] => [file, { mode: "100644", content: text(file) }]),
        ]),
      );
  };

  const list = (files: Workspace) =>
    Object.fromEntries([...files].map(([file, { content }]) => [file, Buffer.from(content).toString()]));

  it("leaves out what git leaves out, off the fixed list", async () => {
    // Not .git, which git takes for a repo of its own.
    await fc.assert(
      fc.asyncProperty(workspaceOf(NAMES.filter((name) => name !== ".git")), async (files) => {
        const dir = await run();
        await write(path.join(dir, "work"), files);
        gitCli(["init", "-q", path.join(dir, "repo")]);
        const others = gitCli([
          "--git-dir", path.join(dir, "repo/.git"), "--work-tree", path.join(dir, "work"),
          "ls-files", "--others", "--exclude-standard", "-z",
        ]);
        const byGit = others.split("\0").filter(Boolean).filter((file) => !fixed(file)).sort();
        const listed = (await listSource(path.join(dir, "work"))).map((file) => file.path).filter((file) => !fixed(file));
        expect(listed.sort(), JSON.stringify(list(files))).toEqual(byGit);
      }),
      { numRuns: 60 },
    );
  }, 60_000);
});

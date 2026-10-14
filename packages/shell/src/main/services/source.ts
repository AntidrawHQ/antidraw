import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import git, { Errors, type HttpClient, type TreeEntry } from "isomorphic-git";

// A workspace's source as a commit in its site's git repo (Artifacts, see
// @antidraw/server's source.service.ts): what a publish is built from, and
// what a remix clones. The commits are made in a bare repo beside the
// workspace (gitDir), so a git repo the user keeps in it is never touched.
// No Electron here; publish.ts drives it.

const MiB = 1024 * 1024;

// Artifacts' limits: a file over 32 MiB is refused, and so is a push of about
// 64 MiB. New files go up in batches well under that, one commit each, so a
// push on a slow uplink stays short, and a publish that fails partway keeps
// what it pushed: the next one builds on it and sends only the rest.
export const MAX_FILE_BYTES = 32 * MiB;
export const MAX_SOURCE_BYTES = 1024 * MiB;
export const MAX_PUSH_BYTES = 16 * MiB;

// Never part of the source, whatever the workspace's .gitignore files say, a
// `!` in one included: git's own (.git as a file too: a submodule's or
// worktree's names a folder on this machine), what npm and the build make,
// and secrets. Each is a name, matched at any depth.
const ALWAYS_IGNORED = [
  ".git",
  "node_modules/",
  "dist/",
  "out/",
  ".vite/",
  ".env*",
  ".dev.vars",
  ".DS_Store",
  "*.pem",
  "*.key",
  "id_rsa*",
  "id_ed25519*",
];
const alwaysIgnored = ignore().add(ALWAYS_IGNORED);

type Mode = "100644" | "100755" | "120000";

export type SourceFile = { path: string; size: number; mtimeMs: number; mode: Mode };

const author = { name: "Antidraw", email: "publish@antidraw.com" };

/** Makes gitDir a bare repo, if it isn't one yet. */
export const initSource = async (gitDir: string) => {
  await git.init({ fs: nodeFs, gitdir: gitDir, bare: true, defaultBranch: "main" });
};

/**
 * The files the source is made of, by path ('/'-separated): everything in
 * sourceDir but what .gitignore files and ALWAYS_IGNORED leave out. Ignored
 * folders aren't entered, as git doesn't.
 */
export const listSource = async (sourceDir: string): Promise<SourceFile[]> => {
  const files: SourceFile[] = [];
  // Each folder's .gitignore applies below it, with paths relative to it.
  const walk = async (rel: string, rules: { base: string; ignore: Ignore }[]) => {
    const dir = path.join(sourceDir, rel);
    const gitignore = await fs.readFile(path.join(dir, ".gitignore"), "utf8").catch(() => null);
    if (gitignore !== null) rules = [...rules, { base: rel, ignore: ignore().add(gitignore) }];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const file = rel ? `${rel}/${entry.name}` : entry.name;
      const folder = entry.isDirectory();
      if (alwaysIgnored.ignores(folder ? `${entry.name}/` : entry.name)) continue;
      if (ignored(rules, folder ? `${file}/` : file)) continue;
      if (folder) {
        await walk(file, rules);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const stat = await fs.lstat(path.join(sourceDir, file));
      const mode = stat.isSymbolicLink() ? "120000" : stat.mode & 0o111 ? "100755" : "100644";
      files.push({ path: file, size: stat.size, mtimeMs: stat.mtimeMs, mode });
    }
  };
  await walk("", []);
  return files;
};

// As git decides: the deepest .gitignore with a say wins, so one can re-include
// what a parent's left out.
const ignored = (rules: { base: string; ignore: Ignore }[], file: string) => {
  let result = false;
  for (const { base, ignore } of rules) {
    const { ignored, unignored } = ignore.test(base ? file.slice(base.length + 1) : file);
    if (ignored) result = true;
    else if (unignored) result = false;
  }
  return result;
};

export type SourceProblem = { code: "FILE_TOO_LARGE" | "SOURCE_TOO_LARGE"; message: string };

const size = (bytes: number) =>
  bytes >= 1024 * MiB
    ? `${(bytes / 1024 / MiB).toFixed(1).replace(/\.0$/, "")} GB`
    : `${Math.max(1, Math.round(bytes / MiB))} MB`;

const biggest = (files: SourceFile[], count: number) =>
  [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, count)
    .map((file) => `  ${file.path} (${size(file.size)})`);

/** Why the files can't be published, in words for the user; null if they can. */
export const sourceProblem = (files: SourceFile[]): SourceProblem | null => {
  const tooBig = files.filter((file) => file.size > MAX_FILE_BYTES);
  if (tooBig.length > 0) {
    const which = tooBig.length === 1 ? "A file is" : `${tooBig.length} files are`;
    return {
      code: "FILE_TOO_LARGE",
      message: [
        `${which} too big to publish. Each file can be up to ${size(MAX_FILE_BYTES)}:`,
        ...biggest(tooBig, 10),
        ...(tooBig.length > 10 ? [`  and ${tooBig.length - 10} more`] : []),
        `Delete ${tooBig.length === 1 ? "it or add it" : "them or add them"} to .gitignore, then publish again.`,
      ].join("\n"),
    };
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_SOURCE_BYTES) {
    return {
      code: "SOURCE_TOO_LARGE",
      message: [
        `This workspace's files add up to ${size(total)}, and a published workspace can be up to ` +
          `${size(MAX_SOURCE_BYTES)}. The biggest:`,
        ...biggest(files, 5),
        "Delete files you don't need or add them to .gitignore, then publish again.",
      ].join("\n"),
    };
  }
  return null;
};

/** The files that changed, went away or appeared since they were listed, by path. */
export const changedSince = async (sourceDir: string, files: SourceFile[]) => {
  const listed = new Map(files.map((file) => [file.path, file]));
  const changed = new Set<string>();
  for (const file of await listSource(sourceDir)) {
    const was = listed.get(file.path);
    if (!was || was.size !== file.size || was.mtimeMs !== file.mtimeMs || was.mode !== file.mode) {
      changed.add(file.path);
    }
    listed.delete(file.path);
  }
  for (const file of listed.keys()) changed.add(file);
  return [...changed].sort();
};

type Entry = { oid: string; mode: Mode };

/**
 * Groups new blobs into pushes of at most maxBytes each, in path order. A
 * blob bigger than maxBytes goes alone.
 */
export const batches = <T extends { size: number }>(blobs: T[], maxBytes: number): T[][] => {
  const result: T[][] = [];
  let batch: T[] = [];
  let bytes = 0;
  for (const blob of blobs) {
    if (batch.length > 0 && bytes + blob.size > maxBytes) {
      result.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(blob);
    bytes += blob.size;
  }
  if (batch.length > 0) result.push(batch);
  return result;
};

/**
 * Commits the files on top of parent (main's head in the site's repo, already
 * in gitDir, or null for an empty repo). When the new blobs add up to more
 * than one push can take, earlier commits add them a batch at a time and only
 * the last is the whole snapshot. Answers the commits to push, in order, and
 * the snapshot's: parent itself when nothing changed.
 */
export const commitSource = async ({
  sourceDir,
  gitDir,
  files,
  parent,
  message,
  maxPushBytes = MAX_PUSH_BYTES,
  now = Date.now(),
  cache = {},
}: {
  sourceDir: string;
  gitDir: string;
  files: SourceFile[];
  parent: string | null;
  message: string;
  maxPushBytes?: number;
  now?: number;
  cache?: GitCache;
}): Promise<{ commits: string[]; head: string | null }> => {
  const parentTree = parent
    ? (await git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: parent, cache })).commit.tree
    : null;
  const base = parentTree ? await flatTree(gitDir, parentTree, cache) : new Map<string, Entry>();
  const inParent = new Set([...base.values()].map((entry) => entry.oid));
  const known = new Set(inParent);

  const snapshot = new Map<string, Entry>();
  const added: { path: string; size: number }[] = [];
  for (const file of files) {
    const full = path.join(sourceDir, file.path);
    const blob = file.mode === "120000" ? Buffer.from(await fs.readlink(full)) : await fs.readFile(full);
    const oid = await git.writeBlob({ fs: nodeFs, gitdir: gitDir, blob });
    snapshot.set(file.path, { oid, mode: file.mode });
    if (!known.has(oid)) {
      known.add(oid);
      added.push({ path: file.path, size: blob.length });
    }
  }

  const tree = await writeTree(gitDir, snapshot);
  if (tree === parentTree) return { commits: [], head: parent };

  const groups = batches(added, maxPushBytes);
  const commits: string[] = [];
  let head = parent;
  const commit = async (treeOid: string, text: string) => {
    const person = { ...author, timestamp: Math.floor(now / 1000), timezoneOffset: 0 };
    head = await git.writeCommit({
      fs: nodeFs,
      gitdir: gitDir,
      commit: { tree: treeOid, parent: head ? [head] : [], author: person, committer: person, message: `${text}\n` },
    });
    commits.push(head);
  };
  // Every batch but the last on top of the parent's files; then the snapshot.
  // A file that was a folder, or is in one that was a file, replaces what
  // was there, or the tree would have both under one name.
  const partial = new Map(base);
  const place = (files: Iterable<string>) => {
    const adding = new Set(files);
    for (const file of partial.keys()) {
      if (folders(file).some((folder) => adding.has(folder))) partial.delete(file);
    }
    for (const file of adding) {
      for (const folder of folders(file)) partial.delete(folder);
      partial.set(file, snapshot.get(file)!);
    }
  };
  // A push sends the blobs the commit before it doesn't have, so a blob the
  // snapshot keeps from the parent mustn't leave a part when the file it was
  // in is replaced, or a later push sends it again: it goes where the
  // snapshot has it, which no later part replaces.
  const kept = new Map<string, string>();
  for (const [file, { oid }] of snapshot) if (inParent.has(oid) && !kept.has(oid)) kept.set(oid, file);
  const oids = () => new Set([...partial.values()].map((entry) => entry.oid));
  for (const [index, group] of groups.slice(0, -1).entries()) {
    const had = oids();
    place(group.map(({ path: file }) => file));
    for (;;) {
      const have = oids();
      const lost = [...had].filter((oid) => !have.has(oid) && kept.has(oid));
      if (lost.length === 0) break;
      place(lost.map((oid) => kept.get(oid)!));
    }
    await commit(await writeTree(gitDir, partial), `${message} (part ${index + 1} of ${groups.length})`);
  }
  await commit(tree, groups.length > 1 ? `${message} (part ${groups.length} of ${groups.length})` : message);
  return { commits, head };
};

/** The folders a path is in: `a` and `a/b` for `a/b/c`. */
const folders = (file: string) => {
  const parts = file.split("/");
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("/"));
};

/** A tree's files by path. */
const flatTree = async (gitDir: string, oid: string, cache: GitCache) => {
  const entries: [string, Entry][] = await git.walk({
    fs: nodeFs,
    gitdir: gitDir,
    cache,
    trees: [git.TREE({ ref: oid })],
    map: async (file, [entry]) =>
      (await entry!.type()) === "blob"
        ? [file, { oid: await entry!.oid(), mode: (await entry!.mode()).toString(8) as Mode }]
        : undefined,
  });
  return new Map(entries);
};

/** Writes the trees for files by path; answers the root's oid. */
const writeTree = async (gitDir: string, files: Map<string, Entry>): Promise<string> => {
  const here: TreeEntry[] = [];
  const below = new Map<string, Map<string, Entry>>();
  for (const [file, entry] of files) {
    const slash = file.indexOf("/");
    if (slash === -1) {
      here.push({ path: file, oid: entry.oid, mode: entry.mode, type: "blob" });
      continue;
    }
    const folder = file.slice(0, slash);
    if (!below.has(folder)) below.set(folder, new Map());
    below.get(folder)!.set(file.slice(slash + 1), entry);
  }
  for (const [folder, inside] of below) {
    here.push({ path: folder, oid: await writeTree(gitDir, inside), mode: "040000", type: "tree" });
  }
  return git.writeTree({ fs: nodeFs, gitdir: gitDir, tree: here });
};

/**
 * isomorphic-git's cache of the packs it has read. Each call makes its own
 * unless given one, reading and checking every pack again, so one publish's
 * calls share one.
 */
export type GitCache = object;

/** The site's repo, as saveSource uses it. */
export type SourceRemote = {
  /** main's head, fetched into gitDir to build on; null for an empty repo. */
  head(cache?: GitCache): Promise<string | null>;
  /**
   * Moves main from parent (null: no main yet) to commit, which builds on it.
   * Throws SourceMovedError if main isn't at parent.
   */
  push(commit: string, parent: string | null, cache?: GitCache): Promise<void>;
};

/** main moved since its head was read: another publish of the site pushed. */
export class SourceMovedError extends Error {}

/** A push the repo refused or couldn't take, in its words. */
export class SourcePushError extends Error {}

const NO_COMMIT = "0".repeat(40);

// isomorphic-git's HTTP over the given fetch, so git goes the way the app's
// other requests do (net.fetch: the system's proxy and certificates). The body
// is sent whole: isomorphic-git has made the whole pack by then anyway.
const gitHttp = (fetch: typeof globalThis.fetch): HttpClient => ({
  async request({ url, method = "GET", headers = {}, body, signal }) {
    const chunks: Uint8Array[] = [];
    if (body) for await (const chunk of body) chunks.push(chunk);
    const response = await fetch(url, { method, headers, body: body ? Buffer.concat(chunks) : undefined, signal });
    return {
      url: response.url,
      method,
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: (response.body ?? [new Uint8Array()]) as unknown as AsyncIterableIterator<Uint8Array>,
    };
  },
});

// The repo refusing to move main because it isn't where the push said it
// was: another push got there between ours reading main and updating it.
// Git says "incorrect old value provided" now, "failed to lock" or "failed
// to update ref" before.
const raced = (error: unknown) => {
  if (!(error instanceof Errors.GitPushError)) return false;
  const { result } = error.data as { result: { refs: Record<string, { error?: string }> } };
  return /incorrect old value|failed to (lock|update)|cannot lock|stale|non-fast-forward/i.test(
    result.refs["refs/heads/main"]?.error ?? "",
  );
};

/** The site's repo in Artifacts, over git's HTTP protocol with the given fetch. */
export const artifactsRemote = ({
  gitDir,
  url,
  token,
  fetch,
}: {
  gitDir: string;
  url: string;
  token: string;
  fetch: typeof globalThis.fetch;
}): SourceRemote => {
  // The token without its `?expires=` suffix is git's password, sent from the
  // first request: isomorphic-git asks onAuth only once refused, which would
  // make each request twice. A new object each time, as it adds to them.
  const authorization = `Basic ${Buffer.from(`x:${token.split("?expires=")[0]}`).toString("base64")}`;
  const headers = () => ({ Authorization: authorization });
  const http = gitHttp(fetch);
  const repo = { fs: nodeFs, http, gitdir: gitDir, url };
  // In the repo's words, for the user: why it was refused, or what went wrong.
  const failed = (error: unknown) => {
    if (error instanceof Errors.HttpError) {
      const { statusCode, statusMessage, response } = error.data as {
        statusCode: number;
        statusMessage: string;
        response?: string;
      };
      // isomorphic-git keeps the body only when asking for refs, and it can
      // be a whole web page.
      const said = response?.trim();
      const reason = said && said.length <= 200 && !/<[a-z!]/i.test(said) ? `: ${said}` : "";
      return new SourcePushError(`${[statusCode, statusMessage].filter(Boolean).join(" ")}${reason}`);
    }
    if (error instanceof Errors.GitPushError) {
      const { result } = error.data as { result: { error?: string; refs: Record<string, { error?: string }> } };
      return new SourcePushError(result.error ?? result.refs["refs/heads/main"]?.error ?? "refused, with no reason given");
    }
    return new SourcePushError(error instanceof Error ? error.message : String(error));
  };
  // fetch keeps what it got as origin's, and fails without origin's refspec
  // (NoRefspecError). Until there was one every fetch did, after writing the
  // `shallow` file but before keeping the commits it names, so that's stale.
  const origin = async () => {
    const refspec = await git.getConfig({ fs: nodeFs, gitdir: gitDir, path: "remote.origin.fetch" });
    const current = await git.getConfig({ fs: nodeFs, gitdir: gitDir, path: "remote.origin.url" });
    if (refspec && current === url) return;
    if (!refspec) await fs.rm(path.join(gitDir, "shallow"), { force: true });
    await git.addRemote({ fs: nodeFs, gitdir: gitDir, remote: "origin", url, force: true });
  };
  return {
    async head(cache = {}) {
      try {
        const refs = await git.listServerRefs({ http, url, headers: headers(), prefix: "refs/heads/main" });
        const head = refs.find((ref) => ref.ref === "refs/heads/main")?.oid ?? null;
        const have = async (oid: string) =>
          git.readCommit({ fs: nodeFs, gitdir: gitDir, oid, cache }).then(() => true, () => false);
        if (!head || (await have(head))) return head;
        await origin();
        // What this fetch found, as main may have moved since it was listed.
        const { fetchHead } = await git.fetch({
          ...repo,
          headers: headers(),
          cache,
          ref: "main",
          singleBranch: true,
          depth: 1,
          tags: false,
        });
        return fetchHead;
      } catch (error) {
        throw failed(error);
      }
    },
    async push(commit, parent, cache = {}) {
      try {
        await git.writeRef({ fs: nodeFs, gitdir: gitDir, ref: "refs/heads/main", value: commit, force: true });
        await git.push({
          ...repo,
          headers: headers(),
          cache,
          ref: "main",
          remoteRef: "main",
          // Before anything is packed: a main that moved is likely one this
          // repo doesn't have, and the pack would be all of history down to it.
          onPrePush: ({ remoteRef }) => {
            if (remoteRef.oid !== (parent ?? NO_COMMIT)) throw new SourceMovedError(`main is at ${remoteRef.oid}`);
            return true;
          },
        });
      } catch (error) {
        if (error instanceof SourceMovedError) throw error;
        if (error instanceof Errors.PushRejectedError || raced(error)) {
          throw new SourceMovedError((error as Error).message);
        }
        throw failed(error);
      }
    },
  };
};

/**
 * Commits the files on top of the repo's main and pushes them; answers the
 * commit that is the snapshot. If another publish of the site pushes in
 * between, builds on that once and tries again.
 */
export const saveSource = async ({
  sourceDir,
  gitDir,
  files,
  remote,
  message,
  maxPushBytes,
}: {
  sourceDir: string;
  gitDir: string;
  files: SourceFile[];
  remote: SourceRemote;
  message: string;
  maxPushBytes?: number;
}): Promise<string> => {
  const cache: GitCache = {};
  for (let attempt = 1; ; attempt++) {
    const parent = await remote.head(cache);
    const { commits, head } = await commitSource({ sourceDir, gitDir, files, parent, message, maxPushBytes, cache });
    try {
      let onto = parent;
      for (const commit of commits) {
        await remote.push(commit, onto, cache);
        onto = commit;
      }
      return head!;
    } catch (error) {
      if (error instanceof SourceMovedError && attempt === 1) continue;
      throw error;
    }
  }
};

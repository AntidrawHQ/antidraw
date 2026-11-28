import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import git, { Errors } from "isomorphic-git";
import { z } from "zod";
import type { NpmOutput } from "@/main/lib/package-manager";
import { gitAuthorization, gitHttp, type GitCache } from "./source";

// Forking a published site: a new workspace made from the source its live
// version was built from. The server says which commit that is and hands out
// a token that can only read the site's repo (@antidraw/server's POST
// /api/sites/:id/fork); the commit's files are written into the new
// workspace's folder, npm installs what they ask for, and the frames go where
// the site's canvas.json has them. The fork is its own workspace: it isn't
// tied to the site, and publishing it makes a new one. Its chats don't come
// along; they were never published. No Electron or DB here; fork.service.ts
// supplies those.

export type ForkStatus = "FETCHING_SOURCE" | "INSTALLING_DEPENDENCIES" | "SAVING_WORKSPACE";

export type ForkErrorCode =
  | "SIGNED_OUT"
  | "PUBLISH_DISABLED"
  | "SITE_NOT_FOUND"
  | "NOT_FORKABLE"
  | "SERVER_ERROR"
  | "SOURCE_FAILED"
  | "NPM_INSTALL_FAILED"
  | "FORK_FAILED"
  | "CANCELLED";

export type ForkEvent<Workspace> =
  | { type: "status"; status: ForkStatus }
  | { type: "npm"; output: NpmOutput }
  | { type: "done"; workspace: Workspace }
  | { type: "error"; error: { code: ForkErrorCode; message: string } };

export type ForkLayout = { componentName: string; x: number; y: number; width: number; height: number };

/** What the new workspace is saved with. */
export type ForkedWorkspace = {
  name: string;
  /** The site it was forked from, and which of its versions. */
  siteId: string;
  version: number;
  /** Where the site's canvas had its frames; empty when that couldn't be read. */
  layouts: ForkLayout[];
};

export type ForkOptions<Workspace> = {
  siteId: string;
  /** The new workspace's folder, which isn't there yet, and its project's folder inside it. */
  workspaceDir: string;
  sourceDir: string;
  /**
   * The server as the signed-in user: `fetch` for API paths. Signed out, it
   * answers 401.
   */
  request: (pathname: string, init?: RequestInit) => Promise<Response>;
  /** For the site's repo and its canvas.json: no session goes with these. */
  fetch: typeof globalThis.fetch;
  /** Runs `npm install` in a folder (npmInstall in the app), stopping it on the signal. */
  npmInstall: (cwd: string, signal?: AbortSignal) => AsyncGenerator<NpmOutput>;
  /** Keeps the workspace, once its files are in place and installed. */
  save: (workspace: ForkedWorkspace) => Promise<Workspace>;
  /**
   * Cancels the fork: whatever it's waiting on stops, and it ends with a
   * CANCELLED error and nothing on disk. Once the workspace is being saved,
   * it's too late: the fork goes on to `done`.
   */
  signal?: AbortSignal;
};

class Failure extends Error {
  constructor(
    readonly code: ForkErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const access = z.object({
  remote: z.string().url(),
  token: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  depth: z.number().int().min(1),
  title: z.string(),
  version: z.number().int(),
  filesUrl: z.string().url(),
});

type ForkAccess = z.infer<typeof access>;

// How long the server may take to say where the source is.
const REQUEST_TIMEOUT_MS = 15_000;

// A timeout that the fork's own signal can also end early.
const timeout = (signal?: AbortSignal) =>
  AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);

const forkAccess = async ({ request, siteId, signal }: ForkOptions<unknown>): Promise<ForkAccess> => {
  let response: Response;
  try {
    response = await request(`/api/sites/${encodeURIComponent(siteId)}/fork`, {
      method: "POST",
      signal: timeout(signal),
    });
  } catch {
    signal?.throwIfAborted();
    throw new Failure("SERVER_ERROR", "Couldn't reach the Antidraw server");
  }
  if (response.status === 401) throw new Failure("SIGNED_OUT", "Sign in to fork this site.");
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = access.safeParse(body);
    if (parsed.success) return parsed.data;
    throw new Failure("SERVER_ERROR", "The server's answer couldn't be read");
  }
  const { code, message } = (body as { error?: { code?: string; message?: string } } | null)?.error ?? {};
  if (response.status === 403 && code === "PUBLISH_DISABLED") {
    throw new Failure("PUBLISH_DISABLED", message ?? "Publishing isn't available yet.");
  }
  if (response.status === 404 && code === "SITE_NOT_FOUND") {
    throw new Failure("SITE_NOT_FOUND", "This site isn't published any more.");
  }
  if (response.status === 409 && code === "NOT_FORKABLE" && message) throw new Failure("NOT_FORKABLE", message);
  // A server from before the route answers its 404 too.
  throw new Failure("SERVER_ERROR", message ?? `The server answered ${response.status}`);
};

const canvasFile = z.object({
  layouts: z.array(
    z.object({
      componentName: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  ),
});

// Where the site's canvas has its frames. The fork is worth having without
// them (the canvas lays out frames it has no place for), so this never fails
// it.
const siteLayouts = async (
  fetch: typeof globalThis.fetch,
  filesUrl: string,
  signal?: AbortSignal,
): Promise<ForkLayout[]> => {
  try {
    const response = await fetch(new URL("canvas.json", `${filesUrl.replace(/\/$/, "")}/`).href, {
      signal: timeout(signal),
    });
    if (!response.ok) return [];
    const { layouts } = canvasFile.parse(await response.json());
    // One place per frame, as the workspace keeps them.
    return [...new Map(layouts.map((layout) => [layout.componentName, layout])).values()];
  } catch {
    return [];
  }
};

/** The site's source couldn't be fetched, or isn't something to write to disk. */
export class ForkSourceError extends Error {}

// How many more commits of main are asked for when it has moved on since the
// server said how deep the commit was.
const DEEPER = 20;

// A name git could have in a tree that mustn't reach the disk: one that
// leaves the folder, or is git's own.
const safeName = (name: string) =>
  name !== "" && name !== "." && name !== ".." && !/[/\\\0]/.test(name) && name.toLowerCase() !== ".git";

/**
 * Fetches `commit` from the site's repo, which has it `depth` commits down
 * main, and writes its files into dir, which must be new. gitDir is where the
 * fetch is kept meanwhile: the caller's to remove. The signal stops it, with
 * its reason as the error: isomorphic-git's fetch takes none, so it goes with
 * each of git's requests, and ends one that's stalled.
 */
export const checkoutSource = async ({
  dir,
  gitDir,
  url,
  token,
  commit,
  depth,
  fetch,
  signal,
}: {
  dir: string;
  gitDir: string;
  url: string;
  token: string;
  commit: string;
  depth: number;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}) => {
  const http = gitHttp(signal ? (input, init) => fetch(input, { ...init, signal }) : fetch);
  const authorization = gitAuthorization(token);
  // One for every call, or each reads and checks the whole pack again
  // (source.ts's GitCache).
  const cache: GitCache = {};
  const have = () =>
    git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit, cache }).then(
      ({ commit }) => commit.tree,
      () => null,
    );
  let tree: string | null = null;
  try {
    await git.init({ fs: nodeFs, gitdir: gitDir, bare: true, defaultBranch: "main" });
    await git.addRemote({ fs: nodeFs, gitdir: gitDir, remote: "origin", url, force: true });
    // Main as deep as the commit is. A publish that pushed since the server
    // looked puts it further down: once more, deeper.
    for (const deep of [depth, depth + DEEPER]) {
      await git.fetch({
        fs: nodeFs,
        http,
        gitdir: gitDir,
        url,
        // A new object each time, as isomorphic-git adds to them.
        headers: { Authorization: authorization },
        ref: "main",
        singleBranch: true,
        depth: deep,
        tags: false,
        cache,
      });
      // isomorphic-git takes a pack cut short by a cancel as one that ended:
      // it's the signal that says it was.
      signal?.throwIfAborted();
      tree = await have();
      if (tree) break;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Errors.HttpError) {
      const { statusCode, statusMessage } = error.data as { statusCode: number; statusMessage: string };
      throw new ForkSourceError([statusCode, statusMessage].filter(Boolean).join(" "));
    }
    throw new ForkSourceError(error instanceof Error ? error.message : String(error));
  }
  if (!tree) throw new ForkSourceError("the site was published again meanwhile");

  // Files first, links after: nothing is written through a link this made,
  // on a disk where `A` and `a` are one name. On such a disk, two of the
  // source's names can be one name: neither is written over the other.
  const links: { file: string; to: string }[] = [];
  const clash = (file: string) => (error: unknown) => {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== "EEXIST" && code !== "EISDIR" && code !== "ENOTDIR") throw error;
    throw new ForkSourceError(`the source has two files with one name: ${path.relative(dir, file)}`);
  };
  const write = async (oid: string, rel: string) => {
    signal?.throwIfAborted();
    // isomorphic-git refuses some of these names itself, as it reads the tree.
    const { tree } = await git.readTree({ fs: nodeFs, gitdir: gitDir, oid, cache }).catch((error) => {
      if (!(error instanceof Errors.UnsafeFilepathError)) throw error;
      throw new ForkSourceError(`the source has a file that can't be written: ${rel}${error.data.filepath}`);
    });
    for (const entry of tree) {
      if (!safeName(entry.path)) throw new ForkSourceError(`the source has a file that can't be written: ${rel}${entry.path}`);
      const file = path.join(dir, rel, entry.path);
      if (entry.type === "tree") {
        // Not recursive: its parent is there already, so anything at its
        // name is one of the source's, under another case.
        await fs.mkdir(file).catch(clash(file));
        await write(entry.oid, `${rel}${entry.path}/`);
        continue;
      }
      // A submodule's commit: nothing of it is in this repo.
      if (entry.type !== "blob") continue;
      const { blob } = await git.readBlob({ fs: nodeFs, gitdir: gitDir, oid: entry.oid, cache });
      if (entry.mode === "120000") links.push({ file, to: Buffer.from(blob).toString() });
      else await fs.writeFile(file, blob, { mode: entry.mode === "100755" ? 0o755 : 0o644, flag: "wx" }).catch(clash(file));
    }
  };
  await fs.mkdir(dir, { recursive: true });
  await write(tree, "");
  for (const { file, to } of links) {
    await fs.symlink(to, file).catch(clash(file));
  }
};

/** The name a fork of the site gets. */
export const forkName = (title: string) => `${title.trim() || "Untitled"} (fork)`;

/**
 * Forks the site's live version into a new workspace, saying how it's going.
 * Ends with `done` and the saved workspace, or `error`, with nothing left on
 * disk: CANCELLED when the signal stopped it.
 */
export async function* forkSite<Workspace>(options: ForkOptions<Workspace>): AsyncGenerator<ForkEvent<Workspace>> {
  const { workspaceDir, sourceDir, siteId, signal } = options;
  const gitDir = path.join(workspaceDir, "fork.git");
  let made = false;
  try {
    yield { type: "status", status: "FETCHING_SOURCE" };
    const source = await forkAccess(options);
    signal?.throwIfAborted();
    // Only now is there anything to clear up: the folder is this fork's own.
    await fs.mkdir(workspaceDir, { recursive: true });
    made = true;
    try {
      await checkoutSource({
        dir: sourceDir,
        gitDir,
        url: source.remote,
        token: source.token,
        commit: source.commit,
        depth: source.depth,
        fetch: options.fetch,
        signal,
      });
    } catch (error) {
      if (signal?.aborted || !(error instanceof ForkSourceError)) throw error;
      throw new Failure("SOURCE_FAILED", `Couldn't fetch the site's source (${error.message}). Try again.`);
    } finally {
      await fs.rm(gitDir, { recursive: true, force: true });
    }
    const layouts = await siteLayouts(options.fetch, source.filesUrl, signal);
    signal?.throwIfAborted();

    yield { type: "status", status: "INSTALLING_DEPENDENCIES" };
    // Killed, npm still says how it ended: what's after the loop waits for it
    // to have, so nothing is writing into the folder as it goes.
    for await (const output of options.npmInstall(sourceDir, signal)) {
      yield { type: "npm", output };
      if (output.type === "exit" && output.code !== 0) {
        throw new Failure("NPM_INSTALL_FAILED", "Couldn't install dependencies. Please try again.");
      }
    }

    signal?.throwIfAborted();

    yield { type: "status", status: "SAVING_WORKSPACE" };
    const workspace = await options.save({
      name: forkName(source.title),
      siteId,
      version: source.version,
      layouts,
    });
    yield { type: "done", workspace };
  } catch (error) {
    // Retried, as something npm ran may still be letting go of a file.
    if (made) await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    yield {
      type: "error",
      error: signal?.aborted
        ? { code: "CANCELLED", message: "The fork was cancelled." }
        : error instanceof Failure
          ? { code: error.code, message: error.message }
          : { code: "FORK_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
    };
  }
}

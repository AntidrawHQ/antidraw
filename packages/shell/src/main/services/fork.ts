import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import git, { Errors } from "isomorphic-git";
import { z } from "zod";
import type { NpmOutput } from "@/main/lib/package-manager";
import { gitAuthorization, gitHttp } from "./source";

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
  | "FORK_FAILED";

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
  /** Runs `npm install` in a folder (npmInstall in the app). */
  npmInstall: (cwd: string) => AsyncGenerator<NpmOutput>;
  /** Keeps the workspace, once its files are in place and installed. */
  save: (workspace: ForkedWorkspace) => Promise<Workspace>;
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

const forkAccess = async ({ request, siteId }: ForkOptions<unknown>): Promise<ForkAccess> => {
  let response: Response;
  try {
    response = await request(`/api/sites/${encodeURIComponent(siteId)}/fork`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
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
const siteLayouts = async (fetch: typeof globalThis.fetch, filesUrl: string): Promise<ForkLayout[]> => {
  try {
    const response = await fetch(new URL("canvas.json", `${filesUrl.replace(/\/$/, "")}/`).href, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
 * fetch is kept meanwhile: the caller's to remove.
 */
export const checkoutSource = async ({
  dir,
  gitDir,
  url,
  token,
  commit,
  depth,
  fetch,
}: {
  dir: string;
  gitDir: string;
  url: string;
  token: string;
  commit: string;
  depth: number;
  fetch: typeof globalThis.fetch;
}) => {
  const http = gitHttp(fetch);
  const authorization = gitAuthorization(token);
  const have = () =>
    git.readCommit({ fs: nodeFs, gitdir: gitDir, oid: commit }).then(
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
      });
      tree = await have();
      if (tree) break;
    }
  } catch (error) {
    if (error instanceof Errors.HttpError) {
      const { statusCode, statusMessage } = error.data as { statusCode: number; statusMessage: string };
      throw new ForkSourceError([statusCode, statusMessage].filter(Boolean).join(" "));
    }
    throw new ForkSourceError(error instanceof Error ? error.message : String(error));
  }
  if (!tree) throw new ForkSourceError("the site was published again meanwhile");

  // Files first, links after: nothing is written through a link this made,
  // on a disk where `A` and `a` are one name.
  const links: { file: string; to: string }[] = [];
  const write = async (oid: string, rel: string) => {
    // isomorphic-git refuses some of these names itself, as it reads the tree.
    const { tree } = await git.readTree({ fs: nodeFs, gitdir: gitDir, oid }).catch((error) => {
      if (!(error instanceof Errors.UnsafeFilepathError)) throw error;
      throw new ForkSourceError(`the source has a file that can't be written: ${rel}${error.data.filepath}`);
    });
    for (const entry of tree) {
      if (!safeName(entry.path)) throw new ForkSourceError(`the source has a file that can't be written: ${rel}${entry.path}`);
      const file = path.join(dir, rel, entry.path);
      if (entry.type === "tree") {
        await fs.mkdir(file, { recursive: true });
        await write(entry.oid, `${rel}${entry.path}/`);
        continue;
      }
      // A submodule's commit: nothing of it is in this repo.
      if (entry.type !== "blob") continue;
      const { blob } = await git.readBlob({ fs: nodeFs, gitdir: gitDir, oid: entry.oid });
      if (entry.mode === "120000") links.push({ file, to: Buffer.from(blob).toString() });
      else await fs.writeFile(file, blob, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
    }
  };
  await fs.mkdir(dir, { recursive: true });
  await write(tree, "");
  for (const { file, to } of links) {
    try {
      await fs.symlink(to, file);
    } catch {
      throw new ForkSourceError(`the source has two files with one name: ${path.relative(dir, file)}`);
    }
  }
};

/** The name a fork of the site gets. */
export const forkName = (title: string) => `${title.trim() || "Untitled"} (fork)`;

/**
 * Forks the site's live version into a new workspace, saying how it's going.
 * Ends with `done` and the saved workspace, or `error`, with nothing left on
 * disk.
 */
export async function* forkSite<Workspace>(options: ForkOptions<Workspace>): AsyncGenerator<ForkEvent<Workspace>> {
  const { workspaceDir, sourceDir, siteId } = options;
  const gitDir = path.join(workspaceDir, "fork.git");
  let made = false;
  try {
    yield { type: "status", status: "FETCHING_SOURCE" };
    const source = await forkAccess(options);
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
      });
    } catch (error) {
      if (!(error instanceof ForkSourceError)) throw error;
      throw new Failure("SOURCE_FAILED", `Couldn't fetch the site's source (${error.message}). Try again.`);
    } finally {
      await fs.rm(gitDir, { recursive: true, force: true });
    }
    const layouts = await siteLayouts(options.fetch, source.filesUrl);

    yield { type: "status", status: "INSTALLING_DEPENDENCIES" };
    for await (const output of options.npmInstall(sourceDir)) {
      yield { type: "npm", output };
      if (output.type === "exit" && output.code !== 0) {
        throw new Failure("NPM_INSTALL_FAILED", "Couldn't install dependencies. Please try again.");
      }
    }

    yield { type: "status", status: "SAVING_WORKSPACE" };
    const workspace = await options.save({
      name: forkName(source.title),
      siteId,
      version: source.version,
      layouts,
    });
    yield { type: "done", workspace };
  } catch (error) {
    if (made) await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    yield {
      type: "error",
      error:
        error instanceof Failure
          ? { code: error.code, message: error.message }
          : { code: "FORK_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
    };
  }
}

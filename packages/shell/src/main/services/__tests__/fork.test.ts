import nodeFs from "node:fs";
import fs from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, describe, expect, it } from "vitest";
import type { NpmOutput } from "@/main/lib/package-manager";
import { checkoutSource, forkSite, ForkSourceError, type ForkedWorkspace, type ForkOptions } from "../fork";
import { commitSource, initSource, listSource } from "../source";
import { startGitServer } from "./git-server";

// Forking a site: its source fetched from a real git server (git's own
// http-backend, as source.test.ts has it) and written to disk. Made up: the
// Antidraw server's answer, the site's canvas.json, and npm.

const token = "secret?expires=1700000000";
const authorization = `Basic ${Buffer.from("x:secret").toString("base64")}`;

const dirs: string[] = [];
const servers: http.Server[] = [];
afterAll(async () => {
  for (const server of servers) server.close();
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

const tmp = async () => {
  // Its real path: the tests compare paths, and macOS's tmp is a link.
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-fork-")));
  dirs.push(dir);
  return dir;
};

type Files = Record<string, string | { link: string } | { exec: string }>;

const folder = async (files: Files) => {
  const dir = await tmp();
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (typeof content === "string") await fs.writeFile(full, content);
    else if ("link" in content) await fs.symlink(content.link, full);
    else await fs.writeFile(full, content.exec, { mode: 0o755 });
  }
  return dir;
};

/** A site's repo on a git server; `commit` puts these files on main, as a publish does. */
const site = async () => {
  const root = await tmp();
  const gitDir = path.join(root, "site.git");
  await initSource(gitDir);
  const { url, server } = await startGitServer(root, authorization);
  servers.push(server);
  const moveMain = (to: string) =>
    git.writeRef({ fs: nodeFs, gitdir: gitDir, ref: "refs/heads/main", value: to, force: true });
  return {
    gitDir,
    url: `${url}/site.git`,
    moveMain,
    commit: async (files: Files) => {
      const dir = await folder(files);
      const main = await git.resolveRef({ fs: nodeFs, gitdir: gitDir, ref: "main" }).catch(() => null);
      const { head } = await commitSource({
        sourceDir: dir,
        gitDir,
        files: await listSource(dir),
        parent: main,
        message: "Publish",
        now: 0,
      });
      await moveMain(head!);
      return head!;
    },
  };
};

/**
 * What's in a folder: each file's content, `-> target` for a link, `(exec)`
 * after a file that can run, and `(empty)` for a folder with nothing in it.
 */
const read = async (dir: string) => {
  const files: Record<string, string> = {};
  const walk = async (rel: string) => {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    if (rel && entries.length === 0) files[`${rel}/`] = "(empty)";
    for (const entry of entries) {
      const file = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, file);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isSymbolicLink()) files[file] = `-> ${await fs.readlink(full)}`;
      else files[file] = (await fs.readFile(full, "utf8")) + ((await fs.stat(full)).mode & 0o111 ? " (exec)" : "");
    }
  };
  await walk("");
  return files;
};

/** fetch, noting each request to the git server. */
const recording =
  (log: string[]): typeof fetch =>
  async (input, init = {}) => {
    const url = new URL(String(input));
    const response = await fetch(input, init);
    log.push(`${init.method ?? "GET"} ${url.pathname.replace(/^.*\.git/, "")}${url.search} ${response.status}`);
    return response;
  };

describe("checkoutSource", () => {
  const checkout = async (
    repo: { url: string },
    commit: string,
    depth: number,
    options: { token?: string; log?: string[] } = {},
  ) => {
    const work = await tmp();
    const dir = path.join(work, "source");
    await checkoutSource({
      dir,
      gitDir: path.join(work, "fork.git"),
      url: repo.url,
      token: options.token ?? token,
      commit,
      depth,
      fetch: options.log ? recording(options.log) : fetch,
    });
    return dir;
  };

  it("writes the commit's files, with what can run and what links where", async () => {
    const repo = await site();
    const commit = await repo.commit({
      "package.json": "{}",
      "src/components/user-components/Hero.tsx": "export default () => null",
      "scripts/build.sh": { exec: "#!/bin/sh" },
      "latest.tsx": { link: "src/components/user-components/Hero.tsx" },
    });
    const log: string[] = [];
    expect(await read(await checkout(repo, commit, 1, { log }))).toMatchInlineSnapshot(`
      {
        "latest.tsx": "-> src/components/user-components/Hero.tsx",
        "package.json": "{}",
        "scripts/build.sh": "#!/bin/sh (exec)",
        "src/components/user-components/Hero.tsx": "export default () => null",
      }
    `);
    // One fetch, with the password from the first request.
    expect(log).toMatchInlineSnapshot(`
      [
        "GET /info/refs?service=git-upload-pack 200",
        "POST /git-upload-pack 200",
      ]
    `);
  });

  it("takes the live version from under publishes that pushed after it", async () => {
    const repo = await site();
    await repo.commit({ "a.ts": "first" });
    const live = await repo.commit({ "a.ts": "live", "b.ts": "b" });
    await repo.commit({ "a.ts": "pushed, never live" });
    await repo.commit({ "a.ts": "pushed after that" });
    expect(await read(await checkout(repo, live, 3))).toEqual({ "a.ts": "live", "b.ts": "b" });
  });

  it("looks further down once, when main has moved on since the server said how deep", async () => {
    const repo = await site();
    const live = await repo.commit({ "a.ts": "live" });
    await repo.commit({ "a.ts": "pushed meanwhile" });
    const log: string[] = [];
    // The server looked when the live version was main's head.
    expect(await read(await checkout(repo, live, 1, { log }))).toEqual({ "a.ts": "live" });
    expect(log.filter((line) => line.startsWith("POST"))).toHaveLength(2);
  });

  it("says so when the commit isn't on main, or the repo refuses the token", async () => {
    const repo = await site();
    const live = await repo.commit({ "a.ts": "a" });
    await expect(checkout(repo, "f".repeat(40), 1)).rejects.toThrow(
      new ForkSourceError("the site was published again meanwhile"),
    );
    await expect(checkout(repo, live, 1, { token: "wrong?expires=1700000000" })).rejects.toThrow(
      new ForkSourceError("401 Unauthorized"),
    );
  });

  it("writes nothing outside the folder, whatever the source's files are called", async () => {
    const repo = await site();
    const blob = await git.writeBlob({ fs: nodeFs, gitdir: repo.gitDir, blob: Buffer.from("escaped") });
    const commitTree = async (tree: Parameters<typeof git.writeTree>[0]["tree"]) => {
      const person = { name: "x", email: "x@x", timestamp: 0, timezoneOffset: 0 };
      const commit = await git.writeCommit({
        fs: nodeFs,
        gitdir: repo.gitDir,
        commit: {
          tree: await git.writeTree({ fs: nodeFs, gitdir: repo.gitDir, tree }),
          parent: [],
          author: person,
          committer: person,
          message: "x\n",
        },
      });
      await repo.moveMain(commit);
      return commit;
    };

    for (const name of ["..", ".git", ".GIT"]) {
      const inside = await git.writeTree({
        fs: nodeFs,
        gitdir: repo.gitDir,
        tree: [{ path: "config", mode: "100644", oid: blob, type: "blob" }],
      });
      const commit = await commitTree([{ path: name, mode: "040000", oid: inside, type: "tree" }]);
      const work = await tmp();
      await expect(
        checkoutSource({
          dir: path.join(work, "ws", "source"),
          gitDir: path.join(work, "fork.git"),
          url: repo.url,
          token,
          commit,
          depth: 1,
          fetch,
        }),
      ).rejects.toThrow(`the source has a file that can't be written: ${name}`);
      // Nothing written; clearing up the folder is forkSite's.
      expect(await read(path.join(work, "ws"))).toEqual({ "source/": "(empty)" });
    }

    // Names that are one name on a disk that ignores case, as the Mac's does
    // unless asked otherwise: none is written over another, and the fork
    // says why. A disk that minds case has room for both.
    const probe = await tmp();
    await fs.writeFile(path.join(probe, "case"), "");
    const caseless = await fs.access(path.join(probe, "CASE")).then(
      () => true,
      () => false,
    );
    const written = (dir: Promise<string>) =>
      dir.then(
        () => "both written",
        (error: unknown) => (error instanceof ForkSourceError ? error.message : `not a ForkSourceError: ${error}`),
      );
    const clash = (name: string) => (caseless ? `the source has two files with one name: ${name}` : "both written");
    const folder = await git.writeTree({
      fs: nodeFs,
      gitdir: repo.gitDir,
      tree: [{ path: "x.ts", mode: "100644", oid: blob, type: "blob" }],
    });
    const other = await git.writeBlob({ fs: nodeFs, gitdir: repo.gitDir, blob: Buffer.from("other") });
    expect({
      fileThenFolder: await written(
        checkout(
          repo,
          await commitTree([
            { path: "B", mode: "100644", oid: blob, type: "blob" },
            { path: "b", mode: "040000", oid: folder, type: "tree" },
          ]),
          1,
        ),
      ),
      folderThenFile: await written(
        checkout(
          repo,
          await commitTree([
            { path: "C", mode: "040000", oid: folder, type: "tree" },
            { path: "c", mode: "100644", oid: blob, type: "blob" },
          ]),
          1,
        ),
      ),
      twoFiles: await written(
        checkout(
          repo,
          await commitTree([
            { path: "D", mode: "100644", oid: blob, type: "blob" },
            { path: "d", mode: "100644", oid: other, type: "blob" },
          ]),
          1,
        ),
      ),
      // Nothing written over, but one folder where the source has two.
      twoFolders: await written(
        checkout(
          repo,
          await commitTree([
            { path: "E", mode: "040000", oid: folder, type: "tree" },
            { path: "e", mode: "040000", oid: folder, type: "tree" },
          ]),
          1,
        ),
      ),
    }).toEqual({
      fileThenFolder: clash("b"),
      folderThenFile: clash("c"),
      twoFiles: clash("d"),
      twoFolders: clash("e"),
    });

    // A link and a folder: the folder's file must not land where the link
    // points.
    const outside = await tmp();
    const link = await git.writeBlob({ fs: nodeFs, gitdir: repo.gitDir, blob: Buffer.from(outside) });
    const inside = await git.writeTree({
      fs: nodeFs,
      gitdir: repo.gitDir,
      tree: [{ path: "x.ts", mode: "100644", oid: blob, type: "blob" }],
    });
    const commit = await commitTree([
      { path: "A", mode: "120000", oid: link, type: "blob" },
      { path: "a", mode: "040000", oid: inside, type: "tree" },
    ]);
    expect(await written(checkout(repo, commit, 1))).toBe(clash("A"));
    expect(await read(outside)).toEqual({});
  });
});

describe("forkSite", () => {
  const A = "a".repeat(40);

  /** A fork with a made-up server, site and npm; answers what it said and what it left. */
  const fork = async (
    overrides: Partial<ForkOptions<ForkedWorkspace>> & { answer?: () => Response; canvas?: () => Response },
  ) => {
    const root = await tmp();
    const workspaceDir = path.join(root, "workspace");
    const requests: string[] = [];
    const installs: string[] = [];
    const events: unknown[] = [];
    const { answer, canvas, ...options } = overrides;
    const run = forkSite<ForkedWorkspace>({
      siteId: "site-1",
      workspaceDir,
      sourceDir: path.join(workspaceDir, "source"),
      request: async (pathname, init) => {
        requests.push(`${init?.method} ${pathname}`);
        return answer!();
      },
      fetch: async (input, init) =>
        String(input) === "https://my-site.sites.test/canvas.json"
          ? (canvas?.() ?? new Response(null, { status: 404 }))
          : fetch(input, init),
      async *npmInstall(cwd): AsyncGenerator<NpmOutput> {
        installs.push(path.relative(root, cwd));
        yield { type: "stdout", data: "added 1 package\n" };
        yield { type: "exit", code: 0 };
      },
      save: async (workspace) => workspace,
      ...options,
    });
    for await (const event of run) events.push(event);
    return {
      events,
      requests,
      installs,
      left: await read(root).catch(() => "nothing"),
    };
  };

  const forkable = (repo: { url: string }, commit: string, more: object = {}) =>
    Response.json({
      remote: repo.url,
      token,
      expiresAt: "2030-01-01T00:00:00.000Z",
      commit,
      depth: 1,
      title: "My Site",
      version: 5,
      filesUrl: "https://my-site.sites.test",
      ...more,
    });

  it("makes a workspace of the live version's source, with its frames where the site had them", async () => {
    const repo = await site();
    const commit = await repo.commit({ "package.json": "{}", "src/Hero.tsx": "hero" });
    const layout = { componentName: "Hero", x: 10, y: 20, width: 300, height: 200 };
    expect(
      await fork({
        answer: () => forkable(repo, commit),
        // Each frame once, and nothing else of the file is kept.
        canvas: () => Response.json({ version: 1, name: "My Site", layouts: [layout, layout], components: [] }),
      }),
    ).toMatchInlineSnapshot(`
      {
        "events": [
          {
            "status": "FETCHING_SOURCE",
            "type": "status",
          },
          {
            "status": "INSTALLING_DEPENDENCIES",
            "type": "status",
          },
          {
            "output": {
              "data": "added 1 package
      ",
              "type": "stdout",
            },
            "type": "npm",
          },
          {
            "output": {
              "code": 0,
              "type": "exit",
            },
            "type": "npm",
          },
          {
            "status": "SAVING_WORKSPACE",
            "type": "status",
          },
          {
            "type": "done",
            "workspace": {
              "layouts": [
                {
                  "componentName": "Hero",
                  "height": 200,
                  "width": 300,
                  "x": 10,
                  "y": 20,
                },
              ],
              "name": "My Site (fork)",
              "siteId": "site-1",
              "version": 5,
            },
          },
        ],
        "installs": [
          "workspace/source",
        ],
        "left": {
          "workspace/source/package.json": "{}",
          "workspace/source/src/Hero.tsx": "hero",
        },
        "requests": [
          "POST /api/sites/site-1/fork",
        ],
      }
    `);
  });

  it("is still a fork without the site's canvas, its frames laid out anew", async () => {
    const repo = await site();
    const commit = await repo.commit({ "package.json": "{}" });
    const { events } = await fork({ answer: () => forkable(repo, commit), canvas: () => Response.json({ nope: true }) });
    expect(events.at(-1)).toEqual({
      type: "done",
      workspace: { name: "My Site (fork)", siteId: "site-1", version: 5, layouts: [] },
    });
  });

  it("says why the server won't have it forked, and makes no folder", async () => {
    const refused = (status: number, code: string, message: string) => () =>
      Response.json({ error: { code, message } }, { status });
    const last = async (answer: () => Response) => {
      const { events, left } = await fork({ answer });
      return { ...(events.at(-1) as object), left };
    };
    expect({
      signedOut: await last(() => new Response(null, { status: 401 })),
      off: await last(refused(403, "PUBLISH_DISABLED", "Publishing isn't available yet.")),
      gone: await last(refused(404, "SITE_NOT_FOUND", "No such site")),
      notKept: await last(
        refused(409, "NOT_FORKABLE", "This version's source wasn't kept. Publish the site again, then fork it."),
      ),
      oldServer: await last(refused(404, "NOT_FOUND", "Not found")),
      garbled: await last(() => Response.json({ remote: "not a url" })),
      unreachable: await last(() => {
        throw new TypeError("fetch failed");
      }),
    }).toMatchInlineSnapshot(`
      {
        "garbled": {
          "error": {
            "code": "SERVER_ERROR",
            "message": "The server's answer couldn't be read",
          },
          "left": {},
          "type": "error",
        },
        "gone": {
          "error": {
            "code": "SITE_NOT_FOUND",
            "message": "This site isn't published any more.",
          },
          "left": {},
          "type": "error",
        },
        "notKept": {
          "error": {
            "code": "NOT_FORKABLE",
            "message": "This version's source wasn't kept. Publish the site again, then fork it.",
          },
          "left": {},
          "type": "error",
        },
        "off": {
          "error": {
            "code": "PUBLISH_DISABLED",
            "message": "Publishing isn't available yet.",
          },
          "left": {},
          "type": "error",
        },
        "oldServer": {
          "error": {
            "code": "SERVER_ERROR",
            "message": "Not found",
          },
          "left": {},
          "type": "error",
        },
        "signedOut": {
          "error": {
            "code": "SIGNED_OUT",
            "message": "Sign in to fork this site.",
          },
          "left": {},
          "type": "error",
        },
        "unreachable": {
          "error": {
            "code": "SERVER_ERROR",
            "message": "Couldn't reach the Antidraw server",
          },
          "left": {},
          "type": "error",
        },
      }
    `);
  });

  it("leaves nothing behind when the source can't be fetched, or npm fails", async () => {
    const repo = await site();
    const commit = await repo.commit({ "package.json": "{}" });
    expect({
      noSource: await fork({ answer: () => forkable(repo, A) }),
      npm: await fork({
        answer: () => forkable(repo, commit),
        async *npmInstall(): AsyncGenerator<NpmOutput> {
          yield { type: "stderr", data: "npm error code E404\n" };
          yield { type: "exit", code: 1 };
        },
      }),
      save: await fork({
        answer: () => forkable(repo, commit),
        save: async () => {
          throw new Error("database is locked");
        },
      }),
    }).toMatchInlineSnapshot(`
      {
        "noSource": {
          "events": [
            {
              "status": "FETCHING_SOURCE",
              "type": "status",
            },
            {
              "error": {
                "code": "SOURCE_FAILED",
                "message": "Couldn't fetch the site's source (the site was published again meanwhile). Try again.",
              },
              "type": "error",
            },
          ],
          "installs": [],
          "left": {},
          "requests": [
            "POST /api/sites/site-1/fork",
          ],
        },
        "npm": {
          "events": [
            {
              "status": "FETCHING_SOURCE",
              "type": "status",
            },
            {
              "status": "INSTALLING_DEPENDENCIES",
              "type": "status",
            },
            {
              "output": {
                "data": "npm error code E404
      ",
                "type": "stderr",
              },
              "type": "npm",
            },
            {
              "output": {
                "code": 1,
                "type": "exit",
              },
              "type": "npm",
            },
            {
              "error": {
                "code": "NPM_INSTALL_FAILED",
                "message": "Couldn't install dependencies. Please try again.",
              },
              "type": "error",
            },
          ],
          "installs": [],
          "left": {},
          "requests": [
            "POST /api/sites/site-1/fork",
          ],
        },
        "save": {
          "events": [
            {
              "status": "FETCHING_SOURCE",
              "type": "status",
            },
            {
              "status": "INSTALLING_DEPENDENCIES",
              "type": "status",
            },
            {
              "output": {
                "data": "added 1 package
      ",
                "type": "stdout",
              },
              "type": "npm",
            },
            {
              "output": {
                "code": 0,
                "type": "exit",
              },
              "type": "npm",
            },
            {
              "status": "SAVING_WORKSPACE",
              "type": "status",
            },
            {
              "error": {
                "code": "FORK_FAILED",
                "message": "database is locked",
              },
              "type": "error",
            },
          ],
          "installs": [
            "workspace/source",
          ],
          "left": {},
          "requests": [
            "POST /api/sites/site-1/fork",
          ],
        },
      }
    `);
  });

  it("stops where it is when cancelled, and leaves nothing behind", async () => {
    const repo = await site();
    const commit = await repo.commit({ "package.json": "{}" });
    // What the fork waits on, held up until it's cancelled: a server or a git
    // host that's stopped answering.
    const stalled = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    // Each fork is cancelled at one step, as Cancel would be, in its own folder.
    const at = async (step: string, options: (cancel: AbortController) => Partial<ForkOptions<ForkedWorkspace>>) => {
      const cancel = new AbortController();
      const root = await tmp();
      const saved: string[] = [];
      const { events } = await fork({
        answer: () => forkable(repo, commit),
        signal: cancel.signal,
        workspaceDir: path.join(root, step),
        sourceDir: path.join(root, step, "source"),
        save: async (workspace) => {
          saved.push(workspace.name);
          return workspace;
        },
        ...options(cancel),
      });
      return { events: events.map((event) => JSON.stringify(event)), saved, left: await fs.readdir(root) };
    };
    const git: string[] = [];
    const fetched: string[] = [];
    expect({
      asking: await at("asking", (cancel) => ({
        request: async (_pathname, init) => {
          cancel.abort();
          return stalled(init!.signal!);
        },
      })),
      // Midway through the pack: the git host has gone quiet with the
      // connection still open, so only the cancel ends the request.
      fetching: await at("fetching", (cancel) => ({
        fetch: async (input, init) => {
          const url = String(input);
          // Each request git tries, even one after the cancel.
          git.push(`${init?.method ?? "GET"} ${url.replace(/^.*\.git/, "")} ${init?.signal === cancel.signal ? "cancellable" : "not cancellable"}`);
          // As fetch does with a signal that's gone already.
          init?.signal?.throwIfAborted();
          if (!url.endsWith("/git-upload-pack")) return fetch(input, init);
          const signal = init!.signal!;
          return new Response(
            new ReadableStream({
              start(body) {
                body.enqueue(new TextEncoder().encode("0008NAK\n"));
                signal.addEventListener("abort", () => body.error(signal.reason), { once: true });
                // Cancel, once it's stuck.
                setTimeout(() => cancel.abort(), 10);
              },
            }),
            { headers: { "Content-Type": "application/x-git-upload-pack-result" } },
          );
        },
      })),
      // Cancelled just as git's answer ends, whole: git says nothing of it,
      // and it's the fork that has to see it, not fetch again.
      fetched: await at("fetched", (cancel) => ({
        fetch: async (input, init) => {
          const url = String(input);
          fetched.push(`${init?.method ?? "GET"} ${url.replace(/^.*\.git/, "")}`);
          init?.signal?.throwIfAborted();
          if (!url.endsWith("/git-upload-pack")) return fetch(input, init);
          cancel.abort();
          return new Response("0008NAK\n0000", {
            headers: { "Content-Type": "application/x-git-upload-pack-result" },
          });
        },
      })),
      fetchedAsked: fetched,
      installing: await at("installing", (cancel) => ({
        async *npmInstall(_cwd, signal): AsyncGenerator<NpmOutput> {
          yield { type: "stdout", data: "npm http fetch GET 200 react\n" };
          cancel.abort();
          expect(signal?.aborted).toBe(true);
          // As runNpm does once npm is stopped.
          yield { type: "exit", code: null };
        },
      })),
      // Cancelled as npm was finishing: it's done, but the fork still isn't saved.
      installed: await at("installed", (cancel) => ({
        async *npmInstall(): AsyncGenerator<NpmOutput> {
          yield { type: "stdout", data: "added 1 package\n" };
          cancel.abort();
          yield { type: "exit", code: 0 };
        },
      })),
      git,
    }).toMatchInlineSnapshot(`
      {
        "asking": {
          "events": [
            "{"type":"status","status":"FETCHING_SOURCE"}",
            "{"type":"error","error":{"code":"CANCELLED","message":"The fork was cancelled."}}",
          ],
          "left": [],
          "saved": [],
        },
        "fetched": {
          "events": [
            "{"type":"status","status":"FETCHING_SOURCE"}",
            "{"type":"error","error":{"code":"CANCELLED","message":"The fork was cancelled."}}",
          ],
          "left": [],
          "saved": [],
        },
        "fetchedAsked": [
          "GET /info/refs?service=git-upload-pack",
          "POST /git-upload-pack",
        ],
        "fetching": {
          "events": [
            "{"type":"status","status":"FETCHING_SOURCE"}",
            "{"type":"error","error":{"code":"CANCELLED","message":"The fork was cancelled."}}",
          ],
          "left": [],
          "saved": [],
        },
        "git": [
          "GET /info/refs?service=git-upload-pack cancellable",
          "POST /git-upload-pack cancellable",
        ],
        "installed": {
          "events": [
            "{"type":"status","status":"FETCHING_SOURCE"}",
            "{"type":"status","status":"INSTALLING_DEPENDENCIES"}",
            "{"type":"npm","output":{"type":"stdout","data":"added 1 package\\n"}}",
            "{"type":"npm","output":{"type":"exit","code":0}}",
            "{"type":"error","error":{"code":"CANCELLED","message":"The fork was cancelled."}}",
          ],
          "left": [],
          "saved": [],
        },
        "installing": {
          "events": [
            "{"type":"status","status":"FETCHING_SOURCE"}",
            "{"type":"status","status":"INSTALLING_DEPENDENCIES"}",
            "{"type":"npm","output":{"type":"stdout","data":"npm http fetch GET 200 react\\n"}}",
            "{"type":"npm","output":{"type":"exit","code":null}}",
            "{"type":"error","error":{"code":"CANCELLED","message":"The fork was cancelled."}}",
          ],
          "left": [],
          "saved": [],
        },
      }
    `);
  });
});

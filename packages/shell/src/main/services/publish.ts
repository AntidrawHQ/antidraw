import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHttpTransport, SiteUploadError, uploadSite } from "@antidraw/site-upload/client";
import { err, ok, type Result } from "neverthrow";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import {
  changedSince,
  initSource,
  listSource,
  saveSource,
  sourceProblem,
  SourceMovedError,
  SourcePushError,
  type SourceFile,
  type SourceRemote,
} from "./source";

// Publishing a workspace, given the server to publish to: build the site with
// the workspace's own `vite build` (@antidrawapp/runtime ≥ 0.5.0), add
// canvas.json, push the workspace's source to the site's git repo
// (source.ts), and upload the site, naming the commit it was built from
// (@antidraw/server's /api/sites, then @antidraw/site-upload). No Electron or
// DB here; publish.service.ts supplies those.

export type PublishedSite = { id: string; url: string };

export type PublishError = {
  status: 401 | 409 | 422 | 502;
  code:
    | "SIGNED_OUT"
    | "RUNTIME_TOO_OLD"
    | "FILE_TOO_LARGE"
    | "SOURCE_TOO_LARGE"
    | "BUILD_FAILED"
    | "SOURCE_CHANGED"
    | "SOURCE_FAILED"
    | "UPLOAD_FAILED"
    | "SERVER_ERROR";
  message: string;
};

/** The steps main runs, in order. Checking the account is the renderer's. */
export type PublishStep = "runtime" | "build" | "upload" | "live";

/** How a publish is going, for the panel that shows it. */
export type PublishEvent =
  | { type: "step"; step: PublishStep }
  /** A line of the build's output. */
  | { type: "log"; line: string }
  /** What a step found, once it's done. */
  | { type: "meta"; step: PublishStep; text: string }
  /** `unchanged` files are already on the server and aren't sent. */
  | { type: "upload"; done: number; total: number; unchanged: number; file: string };

export type PublishOptions = {
  /** The workspace's project folder. */
  sourceDir: string;
  /** A bare git repo beside it, kept between publishes (source.ts). */
  gitDir: string;
  canvas: CanvasFile;
  /** The site this workspace published to before, if any. */
  site: PublishedSite | null;
  /**
   * The server as the signed-in user: `fetch` for API paths and the upload
   * URLs it hands out. Signed out, it answers 401.
   */
  request: (url: string, init?: RequestInit) => Promise<Response>;
  /** Runs npm (spawnNpm in the app). */
  npm: (args: string[], cwd: string, options: SpawnOptions & { env: NodeJS.ProcessEnv }) => ChildProcess;
  /** Called with a new site before anything is uploaded to it, to keep it. */
  onSiteCreated: (site: PublishedSite) => Promise<void>;
  /** The site's git repo, given the server's address and token for it (artifactsRemote in the app). */
  sourceRemote: (access: { remote: string; token: string }) => SourceRemote;
  onEvent?: (event: PublishEvent) => void;
};

class Failure extends Error {
  constructor(readonly error: PublishError) {
    super(error.message);
  }
}

const fail = (status: PublishError["status"], code: PublishError["code"], message: string): never => {
  throw new Failure({ status, code, message });
};

const SIGNED_OUT = () => fail(401, "SIGNED_OUT", "Not signed in");

const kB = (bytes: number) => `${Math.round(bytes / 1000)} kB`;

export const publishSite = async (options: PublishOptions): Promise<Result<{ url: string }, PublishError>> => {
  const emit = options.onEvent ?? (() => {});
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-publish-"));
  try {
    emit({ type: "step", step: "runtime" });
    const runtime = await checkRuntime(options.sourceDir);
    // Before the build, which can take a while, so a workspace that can't be
    // published says so at once.
    await initSource(options.gitDir);
    const files = await listSource(options.sourceDir);
    const problem = sourceProblem(files);
    if (problem) fail(422, problem.code, problem.message);
    emit({ type: "meta", step: "runtime", text: runtime });

    emit({ type: "step", step: "build" });
    const started = Date.now();
    await build(options, outDir);
    // The commit has to be what was built.
    const changed = await changedSince(options.sourceDir, files);
    if (changed.length > 0) {
      const named = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : "");
      fail(409, "SOURCE_CHANGED", `${named} changed while publishing. Publish again to include the changes.`);
    }
    const immutable = await hashedFiles(outDir);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    emit({ type: "meta", step: "build", text: `${seconds}s · ${kB(await dirSize(outDir))}` });
    await fs.writeFile(path.join(outDir, "canvas.json"), JSON.stringify(options.canvas));

    // Saving the source is part of uploading, as the panel tells it.
    emit({ type: "step", step: "upload" });
    const { site, access } = await siteSource(options);
    const commit = await pushSource(options, files, access);
    const uploadUrl = await startPublish(options, site, commit);
    try {
      let file = "";
      await uploadSite({
        dir: outDir,
        transport: createHttpTransport({ baseUrl: uploadUrl, fetch: (url, init) => options.request(String(url), init) }),
        immutable: (file) => immutable.has(file),
        onFileUploaded: (uploaded) => void (file = uploaded.path),
        onProgress: (progress) => {
          const unchanged = progress.totalFiles - progress.toUploadFiles;
          if (progress.phase === "uploading") {
            emit({ type: "upload", done: progress.uploadedFiles, total: progress.toUploadFiles, unchanged, file });
          } else if (progress.phase === "committing") {
            const sent = progress.uploadedFiles;
            emit({ type: "meta", step: "upload", text: unchanged ? `${sent} sent · ${unchanged} cached` : `${sent} files` });
            emit({ type: "step", step: "live" });
          }
        },
      });
    } catch (error) {
      if (!(error instanceof SiteUploadError)) throw error;
      if (error.status === 401) SIGNED_OUT();
      fail(502, "UPLOAD_FAILED", `Couldn't upload the site: ${error.message}`);
    }
    return ok({ url: site.url });
  } catch (error) {
    if (error instanceof Failure) return err(error.error);
    throw error;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
};

// Older runtimes build the dev app, not a site. The installed copy is found as
// Node would find it: node_modules here or in a folder above. Answers its
// version.
const checkRuntime = async (sourceDir: string) => {
  let version: string | null = null;
  for (let dir = sourceDir; version === null; dir = path.dirname(dir)) {
    try {
      const file = path.join(dir, "node_modules", "@antidrawapp", "runtime", "package.json");
      version = (JSON.parse(await fs.readFile(file, "utf8")) as { version: string }).version;
    } catch {
      if (path.dirname(dir) === dir) break;
    }
  }
  const [major = 0, minor = 0] = (version ?? "0.0.0").split(".").map(Number);
  if (major === 0 && minor < 5) {
    fail(
      409,
      "RUNTIME_TOO_OLD",
      version
        ? `This workspace has @antidrawapp/runtime ${version}. Publishing needs 0.5.0 or later.`
        : "This workspace doesn't have @antidrawapp/runtime. Publishing needs 0.5.0 or later.",
    );
  }
  return version!;
};

// Vite's output as the user should see it: paths from the workspace, and
// no stack.
const cleanLines = (lines: string[], sourceDir: string) =>
  lines
    .filter((line) => !/^\s+at /.test(line))
    .map((line) => line.replaceAll(sourceDir + path.sep, ""));

// The workspace's own vite, as `npm run build` would run it, but writing to
// outDir so the workspace's dist/ is left alone. Its output goes out a line
// at a time as it comes.
const build = async ({ npm, sourceDir, onEvent }: PublishOptions, outDir: string) => {
  const child = npm(["exec", "--no", "--", "vite", "build", "--outDir", outDir, "--emptyOutDir"], sourceDir, {
    env: { NODE_ENV: "production", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let pending = "";
  const take = (data: Buffer | string) => {
    output += data;
    const lines = (pending + data).split(/\r?\n/);
    pending = lines.pop()!;
    for (const line of cleanLines(lines, sourceDir)) onEvent?.({ type: "log", line });
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", (error) => {
      take(error.message);
      resolve(1);
    });
  });
  if (pending) take("\n");
  if (code !== 0) {
    const start = output.indexOf("error during build:");
    const log = cleanLines((start === -1 ? output : output.slice(start)).split("\n").slice(start === -1 ? -20 : 0), sourceDir)
      .join("\n")
      .trim();
    fail(422, "BUILD_FAILED", `Couldn't build the workspace.\n${log}`);
  }
};

const dirSize = async (dir: string) => {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  const sizes = await Promise.all(
    entries.filter((entry) => entry.isFile()).map(async (entry) => (await fs.stat(path.join(entry.parentPath, entry.name))).size),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
};

// Vite's manifest lists the content-hashed files, which can be cached for
// good. It isn't part of the site.
const hashedFiles = async (outDir: string) => {
  const vite = path.join(outDir, ".vite");
  const manifest = JSON.parse(await fs.readFile(path.join(vite, "manifest.json"), "utf8")) as Record<
    string,
    { file: string; css?: string[]; assets?: string[] }
  >;
  await fs.rm(vite, { recursive: true });
  return new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]));
};

const api = async (options: PublishOptions, pathname: string, body?: unknown) => {
  let response: Response;
  try {
    response = await options.request(pathname, {
      method: "POST",
      ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    return fail(502, "SERVER_ERROR", "Couldn't reach Antidraw. Check your connection and try again.");
  }
  if (response.status === 401) SIGNED_OUT();
  return response;
};

type ErrorBody = { error?: { code?: string; message?: string } } | null;

const errorBody = async (response: Response) => (await response.json().catch(() => null)) as ErrorBody;

const serverError = async (response: Response, body?: ErrorBody): Promise<never> => {
  const { error } = (body === undefined ? await errorBody(response) : body) ?? {};
  return fail(502, "SERVER_ERROR", error?.message ?? `The server answered ${response.status}`);
};

// The workspace's site, made on first publish, and a token to push to its
// source repo. A site the server doesn't know (deleted, or another account's)
// is replaced.
const siteSource = async (options: PublishOptions) => {
  let site = options.site;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!site) {
      const created = await api(options, "/api/sites", { title: options.canvas.name });
      if (!created.ok) return serverError(created);
      const { id, url } = (await created.json()) as PublishedSite;
      site = { id, url };
      await options.onSiteCreated(site);
    }
    const source = await api(options, `/api/sites/${encodeURIComponent(site.id)}/source`);
    if (source.ok) return { site, access: (await source.json()) as { remote: string; token: string } };
    // Only the server saying it has no such site replaces it; any other 404
    // (a route that isn't there) is an error to see.
    const body = await errorBody(source);
    if (source.status !== 404 || body?.error?.code !== "SITE_NOT_FOUND") return serverError(source, body);
    site = null;
  }
  return fail(502, "SERVER_ERROR", "The server lost the new site");
};

const pushSource = async (
  { sourceDir, gitDir, sourceRemote }: PublishOptions,
  files: SourceFile[],
  access: { remote: string; token: string },
) => {
  try {
    return await saveSource({ sourceDir, gitDir, files, remote: sourceRemote(access), message: "Publish" });
  } catch (error) {
    if (error instanceof SourceMovedError) {
      const message = "This site is being published from somewhere else too. Publish again once that's done.";
      return fail(409, "SOURCE_FAILED", message);
    }
    if (error instanceof SourcePushError) {
      return fail(502, "SOURCE_FAILED", `Couldn't save the workspace's source (${error.message}). Try publishing again.`);
    }
    throw error;
  }
};

// A publish of the site, built from commit in its source repo.
const startPublish = async (options: PublishOptions, site: PublishedSite, commit: string) => {
  const started = await api(options, `/api/sites/${encodeURIComponent(site.id)}/publishes`, { commit });
  if (!started.ok) return serverError(started);
  return ((await started.json()) as { uploadUrl: string }).uploadUrl;
};

import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHttpTransport, SiteUploadError, uploadSite } from "@antidraw/site-upload/client";
import { err, ok, type Result } from "neverthrow";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";

// Publishing a workspace, given the server to publish to: build the site with
// the workspace's own `vite build` (@antidrawapp/runtime ≥ 0.5.0), add
// canvas.json, and upload it to the workspace's site (@antidraw/server's
// /api/sites, then @antidraw/site-upload). No Electron or DB here;
// publish.service.ts supplies those.

export type PublishedSite = { id: string; url: string };

export type PublishError = {
  status: 401 | 409 | 422 | 502;
  code: "SIGNED_OUT" | "RUNTIME_TOO_OLD" | "BUILD_FAILED" | "UPLOAD_FAILED" | "SERVER_ERROR";
  message: string;
};

export type PublishOptions = {
  /** The workspace's project folder. */
  sourceDir: string;
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

export const publishSite = async (options: PublishOptions): Promise<Result<{ url: string }, PublishError>> => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-publish-"));
  try {
    await checkRuntime(options.sourceDir);
    await build(options, outDir);
    const immutable = await hashedFiles(outDir);
    await fs.writeFile(path.join(outDir, "canvas.json"), JSON.stringify(options.canvas));

    const { site, uploadUrl } = await startPublish(options);
    try {
      await uploadSite({
        dir: outDir,
        transport: createHttpTransport({ baseUrl: uploadUrl, fetch: (url, init) => options.request(String(url), init) }),
        immutable: (file) => immutable.has(file),
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
// Node would find it: node_modules here or in a folder above.
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
      `Publishing needs @antidrawapp/runtime 0.5.0 or later; this workspace has ${version ?? "none installed"}`,
    );
  }
};

// The workspace's own vite, as `npm run build` would run it, but writing to
// outDir so the workspace's dist/ is left alone.
const build = async ({ npm, sourceDir }: PublishOptions, outDir: string) => {
  const child = npm(["exec", "--no", "--", "vite", "build", "--outDir", outDir, "--emptyOutDir"], sourceDir, {
    env: { NODE_ENV: "production", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (data: Buffer) => (output += data));
  child.stderr?.on("data", (data: Buffer) => (output += data));
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", (error) => {
      output += error.message;
      resolve(1);
    });
  });
  if (code !== 0) {
    // Vite's error, with paths from the workspace and without the stack.
    const start = output.indexOf("error during build:");
    const log = (start === -1 ? output.split("\n").slice(-20).join("\n") : output.slice(start))
      .split("\n")
      .filter((line) => !/^\s+at /.test(line))
      .join("\n")
      .replaceAll(sourceDir + path.sep, "")
      .trim();
    fail(422, "BUILD_FAILED", `Couldn't build the workspace\n${log}`);
  }
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
    return fail(502, "SERVER_ERROR", "Couldn't reach the Antidraw server");
  }
  if (response.status === 401) SIGNED_OUT();
  return response;
};

const serverError = async (response: Response): Promise<never> => {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return fail(502, "SERVER_ERROR", body?.error?.message ?? `The server answered ${response.status}`);
};

// A publish of the workspace's site, making the site on first publish. A site
// the server doesn't know (deleted, or another account's) is replaced.
const startPublish = async (options: PublishOptions) => {
  let site = options.site;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!site) {
      const created = await api(options, "/api/sites", { title: options.canvas.name });
      if (!created.ok) return serverError(created);
      const { id, url } = (await created.json()) as PublishedSite;
      site = { id, url };
      await options.onSiteCreated(site);
    }
    const started = await api(options, `/api/sites/${encodeURIComponent(site.id)}/publishes`);
    if (started.ok) return { site, uploadUrl: ((await started.json()) as { uploadUrl: string }).uploadUrl };
    if (started.status !== 404) return serverError(started);
    site = null;
  }
  return fail(502, "SERVER_ERROR", "The server lost the new site");
};

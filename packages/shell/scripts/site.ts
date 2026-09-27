// Publish a workspace by hand, until the shell grows a Publish button.
//
//   npm run site:build -- <workspace id | name | source dir> [--out <dir>]
//   npm run site:serve -- <site dir> [--port 4400]
//   npm run site:upload -- <site dir> [--id <publish id>] [--local | --wrangler]
//
// A site is one self-contained static directory, served from the root of its
// own origin:
//
//   index.html, _antidraw/   the viewer (src/viewer): the canvas, read-only
//   canvas.json              the components and where their frames sit
//   preview.html             the workspace build's index.html, which the
//                            origin serves at /preview (the runtime's route)
//   assets/, public files    the rest of the workspace build
//
// It has to be the origin root, not a path under one: components refer to
// their public files by absolute path ("/clip.mp4"). `serve` answers the same
// way the publish Worker (packages/publish-worker) does, for checking a site
// locally. Turning a build into a site, and listing a site's files, are
// src/publish/site-build.ts, which the app's Publish shares.
//
// upload reads R2 credentials from the environment, or from packages/shell/
// .env.site: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
// and optionally R2_ENDPOINT (e.g. https://<account id>.eu.r2.cloudflarestorage.com
// for an EU bucket). Each site goes under <publish id>/ in the bucket. With
// --local it goes to the local R2 of `wrangler dev` in packages/publish-worker
// instead, and with --wrangler to the real bucket through wrangler, signed in
// with `wrangler login` — neither needs the R2 variables.
//
// Needs Node 22.18 or later (type stripping, node:sqlite).

import { execFile, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { parseArgs, promisify } from "node:util";
import { AwsClient } from "aws4fetch";
import type { CanvasFile } from "../src/viewer/canvas-file.ts";
import { contentType } from "../src/publish/content-types.ts";
import {
  assembleSite,
  checkOutDir,
  emptyOutDir,
  IMMUTABLE_CACHE_CONTROL,
  isBuiltSite,
  listFiles,
  listSiteFiles,
  makeCanvasFile,
  readCanvasComponents,
  SITE_ENTRY_FILES,
} from "../src/publish/site-build.ts";

const execFileAsync = promisify(execFile);
const shellDir = path.resolve(import.meta.dirname, "..");
const RUNTIME_SRC = path.resolve(shellDir, "../plugin-runtime/src");
const antidrawRoot = process.env.ANTIDRAW_ROOT ?? path.join(os.homedir(), ".antidraw");

const fail = (message: string): never => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const run = (args: string[], cwd: string, onFailure?: () => void) => {
  // Production builds, whatever the shell has set (see build-workspace.ts).
  const env = { ...process.env, NODE_ENV: "production" };
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit", env });
  if (result.status !== 0) {
    onFailure?.();
    fail(`${path.basename(args[0]!)} failed in ${cwd}`);
  }
};

const viteBin = (fromDir: string) => {
  const require = createRequire(path.join(fromDir, "package.json"));
  return path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
};

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

type Workspace = { id: string | null; name: string; sourceDir: string };

const openDb = () => {
  const file = path.join(antidrawRoot, "antidraw.db");
  return fs.existsSync(file) ? new DatabaseSync(file, { readOnly: true }) : null;
};

const findWorkspace = (target: string): Workspace => {
  if (fs.existsSync(path.join(target, "package.json"))) {
    const sourceDir = path.resolve(target);
    // A workspace's source dir is <root>/workspaces/<id>/source.
    const id = path.basename(path.dirname(sourceDir));
    const row = openDb()
      ?.prepare("select id, name from workspaces where id = ?")
      .get(id) as { id: string; name: string } | undefined;
    return { id: row?.id ?? null, name: row?.name ?? path.basename(sourceDir), sourceDir };
  }

  const rows = (openDb()
    ?.prepare("select id, name from workspaces where id = ? or name = ?")
    .all(target, target) ?? []) as { id: string; name: string }[];
  if (rows.length === 0) fail(`no workspace with id or name "${target}"`);
  if (rows.length > 1) {
    fail(
      `more than one workspace is named "${target}", use its id:\n` +
        rows.map((r) => `  ${r.id}`).join("\n"),
    );
  }
  const { id, name } = rows[0]!;
  return { id, name, sourceDir: path.join(antidrawRoot, "workspaces", id, "source") };
};

// The same canvas.json the app's Publish writes (makeCanvasFile), with the
// frames from the app's database.
const readCanvasFile = (workspace: Workspace): CanvasFile => {
  const layouts = workspace.id
    ? (openDb()
        ?.prepare(
          `select component_name as componentName, x, y, width, height
             from frame_layouts where workspace_id = ?`,
        )
        .all(workspace.id) as CanvasFile["layouts"] | undefined) ?? []
    : [];
  return makeCanvasFile(workspace.name, readCanvasComponents(workspace.sourceDir), layouts);
};

const build = (target: string, out: string | undefined) => {
  const workspace = findWorkspace(target);
  const { sourceDir } = workspace;
  if (!fs.existsSync(sourceDir)) fail(`${sourceDir} does not exist`);

  const outDir = path.resolve(out ?? path.join(shellDir, "sites", workspace.id ?? workspace.name));
  // The build empties outDir first, so it must be a site built before, or new.
  const problem = checkOutDir(outDir, { appDir: shellDir, sourceDir });
  if (problem) fail(problem);
  console.log(`Building "${workspace.name}" → ${outDir}\n`);

  run([viteBin(shellDir), "build", "-c", "vite.viewer.config.ts", "--logLevel", "warn"], shellDir);
  // The workspace's Vite and config, plus the publish plugins and the preview
  // page from this repo's runtime source (the app will ship its own copy).
  // A build that fails after Vite emptied outDir (copying public/, say)
  // leaves it half-built, which the next build would refuse as not a site.
  const removeHalfBuilt = () => {
    if (!isBuiltSite(outDir)) emptyOutDir(outDir);
  };
  run(
    [path.join(shellDir, "src/publish/build-workspace.ts"), outDir, RUNTIME_SRC],
    sourceDir,
    removeHalfBuilt,
  );

  // Turns the build into a site (the viewer, canvas.json); should any of it
  // fail, the out dir is emptied rather than left for the next build to refuse.
  const canvasFile = readCanvasFile(workspace);
  const assembled = assembleSite({
    outDir,
    viewerDir: path.join(shellDir, "dist-viewer"),
    canvas: canvasFile,
  });
  if (assembled.isErr()) fail(assembled.error.message);

  const { files, bytes } = listFiles(outDir).reduce(
    (acc, f) => ({ files: acc.files + 1, bytes: acc.bytes + fs.statSync(path.join(outDir, f)).size }),
    { files: 0, bytes: 0 },
  );
  const shown = outDir.startsWith(shellDir + path.sep) ? path.relative(shellDir, outDir) : outDir;
  console.log(
    `\nBuilt ${canvasFile.components.length} components, ${files} files (${formatBytes(bytes)}).\n` +
      `  npm run site:serve -- ${shown}\n` +
      `  npm run site:upload -- ${shown}`,
  );
};

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

// As the publish Worker decodes paths: a "%" that starts no valid escape stays.
const decodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname.replace(/(?:%[0-9A-Fa-f]{2})+/g, (escapes) => {
      try {
        return decodeURIComponent(escapes);
      } catch {
        return escapes;
      }
    });
  }
};

// The site's routes: the viewer at /, the workspace's Preview page at /preview,
// and every other path is a file.
const siteFile = (pathname: string) =>
  pathname === "/" ? "index.html" : pathname === "/preview" ? "preview.html" : pathname.slice(1);

const serve = (dir: string, port: number) => {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "canvas.json"))) fail(`${root} is not a built site`);

  http
    .createServer((req, res) => {
      const pathname = decodePath(new URL(req.url ?? "/", "http://x").pathname);
      const file = path.join(root, siteFile(pathname));
      let stat: fs.Stats | undefined | false = false;
      try {
        stat = file.startsWith(root + path.sep) && fs.statSync(file, { throwIfNoEntry: false });
      } catch {
        // A path fs rejects outright, such as one with a NUL byte.
      }
      if (!stat || !stat.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }

      const headers = { "Content-Type": contentType(file), "Accept-Ranges": "bytes" };
      // Video seeks (and Safari playing video at all) need range requests.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(stat.size - Number(range[2]), 0);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => console.log(`Serving ${root}\n  http://localhost:${port}/`));
};

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

const formatBytes = (n: number) =>
  n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

// A single PUT takes up to 5 GiB; larger files would need a multipart upload.
// wrangler refuses files over 300 MiB.
const MAX_PUT_BYTES = { s3: 5 * 1024 ** 3 - 5 * 1024 ** 2, wrangler: 300 * 1024 ** 2 };
// wrangler takes the key as part of a "bucket/key" argument and mangles some
// characters on the way (the local R2 stores them percent-encoded, "?" and
// "#" end the key), so it is given only keys that need no encoding.
const WRANGLER_SAFE_KEY_RE = /^[A-Za-z0-9._~\/-]+$/;

const UPLOAD_CONCURRENCY = 8;
const UPLOAD_ATTEMPTS = 4;

type PutObject = (
  key: string,
  file: string,
  meta: { contentType: string; cacheControl?: string; size: number },
) => Promise<void>;

// R2's S3 API, with the credentials from the environment.
const r2Put = (): { bucket: string; put: PutObject } => {
  const env = (name: string) => process.env[name] || fail(`${name} is not set (see .env.site)`);
  const endpoint =
    process.env.R2_ENDPOINT || `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const bucket = env("R2_BUCKET");
  const client = new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });

  const put: PutObject = async (key, file, meta) => {
    const url = `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const headers: Record<string, string> = {
      "Content-Type": meta.contentType,
      "Content-Length": String(meta.size),
    };
    if (meta.cacheControl) headers["Cache-Control"] = meta.cacheControl;
    // R2 takes an unsigned payload, so only the headers are signed and the
    // body streams from disk.
    const signed = await client.sign(url, { method: "PUT", headers });
    const res = await fetch(url, {
      method: "PUT",
      headers: signed.headers,
      body: Readable.toWeb(fs.createReadStream(file)) as ReadableStream,
      duplex: "half",
    } as RequestInit);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  };
  return { bucket, put };
};

// Through wrangler, as whoever `wrangler login` signed in: the local R2 that
// `wrangler dev` serves the publish Worker from, or the real bucket.
const workerDir = path.resolve(shellDir, "../publish-worker");
// Must match r2_buckets in packages/publish-worker/wrangler.jsonc.
const LOCAL_BUCKET = "antidraw-sites";

const wranglerPut = (where: "local" | "remote"): { bucket: string; put: PutObject } => {
  const wrangler = path.join(
    path.dirname(createRequire(path.join(workerDir, "package.json")).resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
  const put: PutObject = async (key, file, meta) => {
    const args = [wrangler, "r2", "object", "put", `${LOCAL_BUCKET}/${key}`, "--file", file,
      "--content-type", meta.contentType, `--${where}`];
    if (meta.cacheControl) args.push("--cache-control", meta.cacheControl);
    await execFileAsync(process.execPath, args, { cwd: workerDir });
  };
  return { bucket: `${LOCAL_BUCKET} (${where}, via wrangler)`, put };
};

const upload = async (
  dir: string,
  publishId: string | undefined,
  via: "s3" | "local" | "remote",
) => {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "canvas.json"))) fail(`${root} is not a built site`);

  // The id will name the site's subdomain, so it keeps to what a DNS label allows.
  const id = publishId ?? randomBytes(5).toString("hex");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(id)) fail(`"${id}" cannot be a publish id`);

  const { bucket, put } = via === "s3" ? r2Put() : wranglerPut(via);
  // The pages and the canvas go up last (see SITE_ENTRY_FILES); hidden files
  // not at all (see listSiteFiles).
  const site = await listSiteFiles(root).catch((e: Error) => fail(e.message));
  if (site.skipped.length) console.log(`Skipping hidden files:\n  ${site.skipped.join("\n  ")}`);
  const siteFiles = new Map([...site.files, ...site.entries].map((f) => [f.path, f]));
  const files = [...siteFiles.keys()];
  const sizes = new Map(files.map((f) => [f, siteFiles.get(f)!.size]));
  const maxBytes = via === "s3" ? MAX_PUT_BYTES.s3 : MAX_PUT_BYTES.wrangler;
  const tooBig = files.filter((f) => sizes.get(f)! > maxBytes);
  if (tooBig.length) {
    fail(`files over ${formatBytes(maxBytes)} cannot be uploaded ${via === "s3" ? "yet" : "through wrangler"}:\n  ${tooBig.join("\n  ")}`);
  }
  if (via !== "s3") {
    const unsafe = files.filter((f) => !WRANGLER_SAFE_KEY_RE.test(f));
    if (unsafe.length) {
      fail(`these file names cannot go through wrangler (upload without --local or --wrangler):\n  ${unsafe.join("\n  ")}`);
    }
  }

  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  console.log(`Uploading ${files.length} files (${formatBytes(total)}) to ${bucket}/${id}/`);

  let done = 0;
  let uploadedBytes = 0;
  const queue: string[] = [];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const siteFile = siteFiles.get(file)!;
      const meta = {
        contentType: siteFile.contentType,
        cacheControl: siteFile.immutable ? IMMUTABLE_CACHE_CONTROL : undefined,
        size: siteFile.size,
      };
      for (let attempt = 1; ; attempt++) {
        try {
          await put(`${id}/${file}`, path.join(root, file), meta);
          break;
        } catch (e) {
          if (attempt === UPLOAD_ATTEMPTS) fail(`uploading ${file}: ${(e as Error).message}`);
          // Throttling (429) and brief R2 or network errors pass; back off.
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
        }
      }
      done++;
      uploadedBytes += meta.size;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  ${done}/${files.length} files, ${formatBytes(uploadedBytes)}`);
      }
    }
  };
  const uploadAll = (batch: string[]) => {
    queue.push(...batch);
    return Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
  };
  await uploadAll(site.files.map((f) => f.path));
  for (const entry of SITE_ENTRY_FILES) await uploadAll([entry]);
  console.log(`\nDone: ${bucket}/${id}/`);
  if (via === "local") {
    console.log(`  npm run dev -w @antidraw/publish-worker, then open http://${id}.localhost:8787/`);
  }
};

// ---------------------------------------------------------------------------

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    port: { type: "string", default: "4400" },
    id: { type: "string" },
    local: { type: "boolean", default: false },
    wrangler: { type: "boolean", default: false },
  },
});
const [command, target] = positionals;
if (!target) fail("usage: site.ts build|serve|upload <target> (see the top of scripts/site.ts)");

if (command === "build") build(target!, values.out);
else if (command === "serve") serve(target!, Number(values.port));
else if (command === "upload") {
  await upload(target!, values.id, values.local ? "local" : values.wrangler ? "remote" : "s3");
}
else fail(`unknown command "${command}"`);

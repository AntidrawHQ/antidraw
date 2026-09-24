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
// locally.
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

const execFileAsync = promisify(execFile);
const shellDir = path.resolve(import.meta.dirname, "..");
const RUNTIME_SRC = path.resolve(shellDir, "../plugin-runtime/src");
const antidrawRoot = process.env.ANTIDRAW_ROOT ?? path.join(os.homedir(), ".antidraw");
const USER_COMPONENTS_DIR = "src/components/user-components";
// Same rule as the runtime plugin: names Preview cannot load.
const UNUSABLE_NAME_RE = /[/\\?#\0]/;
// Where build-workspace.ts has Vite write its manifest.
const BUILD_MANIFEST = ".vite/manifest.json";
// The workspace build's content-hashed files, which upload caches for a year.
// Only upload reads it; it is not uploaded.
const HASHED_FILES = ".hashed-files.json";

const fail = (message: string): never => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const run = (args: string[], cwd: string) => {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) fail(`${path.basename(args[0]!)} failed in ${cwd}`);
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

const readCanvasFile = (workspace: Workspace): CanvasFile => {
  const dir = path.join(workspace.sourceDir, USER_COMPONENTS_DIR);
  const components = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ name: f.slice(0, -".tsx".length) }))
    .filter(({ name }) => name && !UNUSABLE_NAME_RE.test(name));

  const layouts = workspace.id
    ? (openDb()
        ?.prepare(
          `select component_name as componentName, x, y, width, height
             from frame_layouts where workspace_id = ?`,
        )
        .all(workspace.id) as CanvasFile["layouts"] | undefined) ?? []
    : [];

  return { version: 1, name: workspace.name, components, layouts };
};

const build = (target: string, out: string | undefined) => {
  const workspace = findWorkspace(target);
  const { sourceDir } = workspace;
  if (!fs.existsSync(sourceDir)) fail(`${sourceDir} does not exist`);

  const outDir = path.resolve(out ?? path.join(shellDir, "sites", workspace.id ?? workspace.name));
  // The build empties outDir first, so it must be a site built before, or new.
  const contains = (dir: string, inner: string) =>
    inner === dir || inner.startsWith(dir + path.sep);
  if (contains(outDir, shellDir) || contains(outDir, sourceDir)) {
    fail(`${outDir} holds the app or the workspace; pick another --out`);
  }
  if (
    fs.existsSync(outDir) &&
    fs.readdirSync(outDir).length > 0 &&
    !fs.existsSync(path.join(outDir, "canvas.json"))
  ) {
    fail(`${outDir} is not empty and is not a built site, and the build would empty it; pick another --out`);
  }
  console.log(`Building "${workspace.name}" → ${outDir}\n`);

  run([viteBin(shellDir), "build", "-c", "vite.viewer.config.ts", "--logLevel", "warn"], shellDir);
  // The workspace's Vite and config, plus the publish plugins and the preview
  // page from this repo's runtime source (the app will ship its own copy).
  run(
    [path.join(shellDir, "src/publish/build-workspace.ts"), outDir, RUNTIME_SRC],
    sourceDir,
  );

  // Everything the viewer adds must be free in the workspace build.
  const viewerDir = path.join(shellDir, "dist-viewer");
  for (const name of ["preview.html", "canvas.json", HASHED_FILES, ...fs.readdirSync(viewerDir)]) {
    if (name === "index.html") continue;
    if (fs.existsSync(path.join(outDir, name))) {
      fail(`the workspace build has its own ${name} (from public/?), which the site needs`);
    }
  }
  fs.renameSync(path.join(outDir, "index.html"), path.join(outDir, "preview.html"));
  // Vite's manifest lists the files the build emitted, all content-hashed;
  // the rest are public/ files, which a republish may change (see upload).
  const manifest = JSON.parse(
    fs.readFileSync(path.join(outDir, BUILD_MANIFEST), "utf8"),
  ) as Record<string, { file: string; css?: string[]; assets?: string[] }>;
  const hashed = new Set(
    Object.values(manifest).flatMap((c) => [c.file, ...(c.css ?? []), ...(c.assets ?? [])]),
  );
  hashed.delete("index.html");
  fs.rmSync(path.join(outDir, ".vite"), { recursive: true, force: true });
  fs.writeFileSync(path.join(outDir, HASHED_FILES), JSON.stringify([...hashed].sort(), null, 2));
  fs.cpSync(viewerDir, outDir, { recursive: true });

  const canvasFile = readCanvasFile(workspace);
  fs.writeFileSync(path.join(outDir, "canvas.json"), JSON.stringify(canvasFile, null, 2));

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

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4v": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

const contentType = (file: string) =>
  CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

// The site's routes: the viewer at /, the workspace's Preview page at /preview,
// and every other path is a file.
const siteFile = (pathname: string) =>
  pathname === "/" ? "index.html" : pathname === "/preview" ? "preview.html" : pathname.slice(1);

const serve = (dir: string, port: number) => {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "canvas.json"))) fail(`${root} is not a built site`);

  http
    .createServer((req, res) => {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
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

const listFiles = (root: string): string[] =>
  (fs.readdirSync(root, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join("/"));

const formatBytes = (n: number) =>
  n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
// The viewer's build output, all content-hashed (it has no public/ files).
const VIEWER_ASSETS_DIR = "_antidraw/";

// The pages and the canvas refer to everything else, so they go up last: a
// visitor never gets a page whose files are not there yet.
const ENTRY_FILES = new Set(["index.html", "preview.html", "canvas.json"]);

// A single PUT takes up to 5 GiB; larger files would need a multipart upload.
// wrangler refuses files over 300 MiB.
const MAX_PUT_BYTES = { s3: 5 * 1024 ** 3 - 5 * 1024 ** 2, wrangler: 300 * 1024 ** 2 };
// wrangler takes the key as part of a "bucket/key" argument and mangles some
// characters on the way (the local R2 stores them percent-encoded, "?" and
// "#" end the key), so it is given only keys that need no encoding.
const WRANGLER_SAFE_KEY_RE = /^[A-Za-z0-9._~\/-]+$/;

const UPLOAD_CONCURRENCY = 8;

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
  const files = listFiles(root).filter((f) => f !== HASHED_FILES);
  const sizes = new Map(files.map((f) => [f, fs.statSync(path.join(root, f)).size]));
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
  const hashedFile = path.join(root, HASHED_FILES);
  const hashed = new Set<string>(
    fs.existsSync(hashedFile) ? JSON.parse(fs.readFileSync(hashedFile, "utf8")) : [],
  );

  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  console.log(`Uploading ${files.length} files (${formatBytes(total)}) to ${bucket}/${id}/`);

  let done = 0;
  let uploadedBytes = 0;
  const queue: string[] = [];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const meta = {
        contentType: contentType(file),
        cacheControl:
          file.startsWith(VIEWER_ASSETS_DIR) || hashed.has(file) ? IMMUTABLE_CACHE_CONTROL : undefined,
        size: sizes.get(file)!,
      };
      for (let attempt = 1; ; attempt++) {
        try {
          await put(`${id}/${file}`, path.join(root, file), meta);
          break;
        } catch (e) {
          if (attempt === 3) fail(`uploading ${file}: ${(e as Error).message}`);
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
  await uploadAll(files.filter((f) => !ENTRY_FILES.has(f)));
  await uploadAll(files.filter((f) => ENTRY_FILES.has(f)));
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

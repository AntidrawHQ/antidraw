// Publish a workspace by hand, until the shell grows a Publish button.
//
//   npm run site:build -- <workspace id | name | source dir> [--out <dir>]
//   npm run site:serve -- <site dir> [--port 4400]
//   npm run site:upload -- <site dir> [--id <slug>] [--local [--persist-to <dir>] | --wrangler]
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
// for an EU bucket). It writes the layout the publish Worker serves: each file
// content at c/cli/<sha256>, then the site's pointer, m/<slug>.json, in one
// write, so the site switches over all at once. A slug the app published is
// refused. With --local it goes to the local R2 of `wrangler dev` in
// packages/publish-worker instead (or the one in --persist-to), and with
// --wrangler to the real bucket through wrangler, signed in with
// `wrangler login` — neither needs the R2 variables.
//
// Needs Node 22.18 or later (type stripping, node:sqlite).

import { execFile, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  isBuiltSite,
  listFiles,
  listSiteFiles,
  makeCanvasFile,
  readCanvasComponents,
  type SiteFile,
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

// The layout the publish Worker serves (packages/publish-worker/src/pointer.ts),
// which the app's Publish writes too: each distinct file content once, at
// c/<owner>/<sha256>, and the site's pointer, m/<slug>.json, naming the
// content of every path. Sites uploaded from here all have the owner "cli";
// the app's have their account's id.
const OWNER = "cli";
const contentKey = (sha256: string) => `c/${OWNER}/${sha256}`;
const pointerKey = (slug: string) => `m/${slug}.json`;

type Pointer = {
  v: 1;
  version: number;
  u: string;
  // "i": 1 marks a file the build named by its content, which the Worker
  // caches for a year (never a public file, whatever its name).
  files: Record<string, { h: string; s: number; t: string; i?: 1 }>;
};

// A single PUT takes up to 5 GiB; larger files would need a multipart upload.
// wrangler refuses files over 300 MiB.
const MAX_PUT_BYTES = { s3: 5 * 1024 ** 3 - 5 * 1024 ** 2, wrangler: 300 * 1024 ** 2 };

const UPLOAD_CONCURRENCY = 8;
const UPLOAD_ATTEMPTS = 4;

type ObjectMeta = { contentType: string; size: number; sha256: string };

type Store = {
  bucket: string;
  // The object's text, or null when there is none.
  read(key: string): Promise<string | null>;
  // Whether the object is there; false when the store cannot tell cheaply.
  has(key: string): Promise<boolean>;
  put(key: string, file: string, meta: ObjectMeta): Promise<void>;
};

const hexToBase64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

// R2's S3 API, with the credentials from the environment.
const s3Store = (): Store => {
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
  const urlOf = (key: string) =>
    `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = async (key: string, init: RequestInit & { headers?: Record<string, string> }) => {
    const url = urlOf(key);
    // R2 takes an unsigned payload, so only the headers are signed and a
    // body streams from disk.
    const signed = await client.sign(url, { method: init.method, headers: init.headers ?? {} });
    return fetch(url, { ...init, headers: signed.headers });
  };

  return {
    bucket,
    async read(key) {
      const res = await send(key, { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.text();
    },
    async has(key) {
      const res = await send(key, { method: "HEAD" });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`HEAD ${res.status}`);
      return true;
    },
    async put(key, file, meta) {
      const res = await send(key, {
        method: "PUT",
        headers: {
          "Content-Type": meta.contentType,
          "Content-Length": String(meta.size),
          // R2 refuses bytes whose sha256 is not this, so nothing lands under
          // another content's key.
          "x-amz-checksum-sha256": hexToBase64(meta.sha256),
          "x-amz-meta-sha256": meta.sha256,
        },
        body: Readable.toWeb(fs.createReadStream(file)) as ReadableStream,
        duplex: "half",
      } as RequestInit & { headers: Record<string, string> });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    },
  };
};

// Through wrangler, as whoever `wrangler login` signed in: the local R2 that
// `wrangler dev` serves the publish Worker from (in persistTo, if given), or
// the real bucket.
const workerDir = path.resolve(shellDir, "../publish-worker");
// Must match r2_buckets in packages/publish-worker/wrangler.jsonc.
const LOCAL_BUCKET = "antidraw-sites";

const wranglerStore = (where: "local" | "remote", persistTo: string | undefined): Store => {
  const wrangler = path.join(
    path.dirname(createRequire(path.join(workerDir, "package.json")).resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
  const target = [`--${where}`, ...(persistTo ? ["--persist-to", path.resolve(persistTo)] : [])];
  // Every key is c/cli/<sha256> or m/<slug>.json, none of which wrangler's
  // "bucket/key" argument mangles.
  const object = (key: string) => `${LOCAL_BUCKET}/${key}`;
  return {
    bucket: `${LOCAL_BUCKET} (${where}${persistTo ? ` in ${persistTo}` : ""}, via wrangler)`,
    async read(key) {
      try {
        const { stdout } = await execFileAsync(
          process.execPath,
          [wrangler, "r2", "object", "get", object(key), "--pipe", ...target],
          { cwd: workerDir, maxBuffer: 64 * 1024 * 1024 },
        );
        return stdout;
      } catch (e) {
        if (/specified key does not exist/i.test(String((e as { stderr?: unknown }).stderr))) {
          return null;
        }
        throw e;
      }
    },
    // Asking would download the object; a content put again is the same bytes.
    has: async () => false,
    async put(key, file, meta) {
      await execFileAsync(
        process.execPath,
        [wrangler, "r2", "object", "put", object(key), "--file", file, "--content-type", meta.contentType, ...target],
        { cwd: workerDir },
      );
    },
  };
};

const withRetries = async <T>(what: string, attempt: () => Promise<T>): Promise<T> => {
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (e) {
      if (n === UPLOAD_ATTEMPTS) fail(`${what}: ${(e as Error).message}`);
      // Throttling (429) and brief R2 or network errors pass; back off.
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (n - 1)));
    }
  }
};

// The pointer already at the slug, which this upload replaces, or null. One
// the app published (another owner) is not the CLI's to replace.
const previousPointer = async (store: Store, slug: string): Promise<Pointer | null> => {
  const text = await withRetries(`reading ${pointerKey(slug)}`, () => store.read(pointerKey(slug)));
  if (text === null) return null;
  let pointer: Partial<Pointer> | null = null;
  try {
    pointer = JSON.parse(text) as Partial<Pointer>;
  } catch {
    // Reported below.
  }
  if (!pointer || pointer.v !== 1 || !Number.isSafeInteger(pointer.version)) {
    fail(`${pointerKey(slug)} is not a site pointer; pick another --id`);
  }
  if (pointer!.u !== OWNER) fail(`"${slug}" is a site published from the app; pick another --id`);
  return pointer as Pointer;
};

const upload = async (
  dir: string,
  slugArg: string | undefined,
  via: "s3" | "local" | "remote",
  persistTo: string | undefined,
) => {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "canvas.json"))) fail(`${root} is not a built site`);

  // The slug names the site's subdomain, so it keeps to what a DNS label allows.
  const slug = slugArg ?? randomBytes(5).toString("hex");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) fail(`"${slug}" cannot be a site id`);

  if (persistTo && via !== "local") fail("--persist-to goes with --local");
  const store = via === "s3" ? s3Store() : wranglerStore(via, persistTo);
  // Hidden files are not the site's (see listSiteFiles). The entry pages are
  // files like any other: nothing is served until the pointer names it.
  const site = await listSiteFiles(root).catch((e: Error) => fail(e.message));
  if (site.skipped.length) console.log(`Skipping hidden files:\n  ${site.skipped.join("\n  ")}`);
  const files = [...site.files, ...site.entries];
  const maxBytes = via === "s3" ? MAX_PUT_BYTES.s3 : MAX_PUT_BYTES.wrangler;
  const tooBig = files.filter((f) => f.size > maxBytes).map((f) => f.path);
  if (tooBig.length) {
    fail(`files over ${formatBytes(maxBytes)} cannot be uploaded ${via === "s3" ? "yet" : "through wrangler"}:\n  ${tooBig.join("\n  ")}`);
  }

  const previous = await previousPointer(store, slug);

  // One object per distinct content, whichever of its paths is read.
  const contents = new Map<string, SiteFile>();
  for (const f of files) if (!contents.has(f.sha256)) contents.set(f.sha256, f);
  const total = [...contents.values()].reduce((sum, f) => sum + f.size, 0);
  console.log(
    `Uploading ${files.length} files (${contents.size} contents, ${formatBytes(total)}) to ${store.bucket} as "${slug}"`,
  );

  let done = 0;
  let sent = 0;
  const queue = [...contents.values()];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const key = contentKey(file.sha256);
      const meta = { contentType: file.contentType, size: file.size, sha256: file.sha256 };
      await withRetries(`uploading ${file.path}`, async () => {
        if (!(await store.has(key))) {
          await store.put(key, path.join(root, file.path), meta);
          sent++;
        }
      });
      done++;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  ${done}/${contents.size} contents, ${sent} sent`);
      }
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));

  // Last, and in one write: the site switches to this upload all at once.
  const pointer: Pointer = {
    v: 1,
    version: (previous?.version ?? 0) + 1,
    u: OWNER,
    files: Object.fromEntries(
      files.map((f) => [
        f.path,
        { h: f.sha256, s: f.size, t: f.contentType, ...(f.immutable ? { i: 1 as const } : {}) },
      ]),
    ),
  };
  const body = JSON.stringify(pointer);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-pointer-"));
  try {
    const file = path.join(tmp, "pointer.json");
    fs.writeFileSync(file, body);
    const meta = {
      contentType: "application/json; charset=utf-8",
      size: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    await withRetries(`writing ${pointerKey(slug)}`, () => store.put(pointerKey(slug), file, meta));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nDone: ${store.bucket} ${pointerKey(slug)} (version ${pointer.version})`);
  if (via === "local") {
    console.log(`  npm run dev -w @antidraw/publish-worker, then open http://${slug}.localhost:8787/`);
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
    "persist-to": { type: "string" },
  },
});
const [command, target] = positionals;
if (!target) fail("usage: site.ts build|serve|upload <target> (see the top of scripts/site.ts)");

if (command === "build") build(target!, values.out);
else if (command === "serve") serve(target!, Number(values.port));
else if (command === "upload") {
  await upload(
    target!,
    values.id,
    values.local ? "local" : values.wrangler ? "remote" : "s3",
    values["persist-to"],
  );
}
else fail(`unknown command "${command}"`);

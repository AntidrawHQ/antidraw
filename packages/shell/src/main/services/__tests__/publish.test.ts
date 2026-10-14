import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { publishSite, type PublishOptions, type PublishedSite } from "../publish";
import { SourceMovedError, SourcePushError, type SourceRemote } from "../source";

// Publishing a workspace end to end: a real `vite build` of a workspace (the
// runtime's test fixture) with the repo's runtime, uploaded to @antidraw/server
// running in workerd with local D1 and R2. Made up: the signed-in user, and
// the source repo's git side (Artifacts has no local mode), which keeps main's
// head in memory and tells the server's stub what was pushed.

const packages = path.resolve(__dirname, "../../../../..");
const runtimeFixture = path.join(packages, "plugin-runtime/test/fixture");

// The server's test harness (packages/server/src/test/harness.ts), imported at
// run time so this package's typecheck doesn't take in the server's Workers
// types. What this test uses of it:
type TestServer = {
  url: URL;
  env: {
    DB: { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } };
    SITES: { get(key: string): Promise<{ json(): Promise<unknown>; text(): Promise<string> } | null> };
  };
  artifacts: { pushed(name: string, commit: string): Promise<void> };
  signIn(): Promise<{ userId: string; authorization: string }>;
  close(): Promise<void>;
};
const startServer = async (): Promise<TestServer> =>
  (await import(/* @vite-ignore */ path.join(packages, "server/src/test/harness.ts"))).startServer();

let server: TestServer;
let user: { userId: string; authorization: string };
const dirs: string[] = [];
beforeAll(async () => {
  // dist/plugin.js, which the workspace's vite.config imports.
  execFileSync("npm", ["run", "build"], { cwd: path.join(packages, "plugin-runtime"), stdio: "ignore" });
  server = await startServer();
  user = await server.signIn();
}, 120_000);
afterAll(async () => {
  await server?.close();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A workspace inside this package, so it resolves the repo's node_modules. */
const workspace = (files: Record<string, string> = {}) => {
  const dir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
  dirs.push(dir);
  fs.cpSync(runtimeFixture, dir, { recursive: true });
  const all = {
    "package.json": JSON.stringify({ type: "module", scripts: { build: "vite build" } }),
    "vite.config.ts": [
      `import react from "@vitejs/plugin-react"`,
      `import { antidraw } from "@antidrawapp/runtime/plugin"`,
      `export default { plugins: [react(), ...antidraw()] }`,
    ].join("\n"),
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
};

const canvas: PublishOptions["canvas"] = {
  version: 1,
  name: "Paper Shaders",
  components: [{ name: "Card" }, { name: "Hero Card" }],
  layouts: [{ componentName: "Card", x: 10, y: 20, width: 300, height: 200 }],
};

/** Each source repo's main, by its remote. */
const heads = new Map<string, string>();

/** The source repo as the server described it, minus git. */
const fakeRemote = (remote: string, pushes: string[], failing: boolean): SourceRemote => ({
  head: async () => heads.get(remote) ?? null,
  async push(commit, parent) {
    if (failing) throw new SourcePushError("403: Invalid or expired token");
    if (parent !== (heads.get(remote) ?? null)) throw new SourceMovedError(`main is at ${heads.get(remote)}`);
    pushes.push(commit);
    heads.set(remote, commit);
    await server.artifacts.pushed(remote.match(/\/(site-[\w-]+)\.git$/)![1]!, commit);
  },
});

/** A bare repo for a workspace's source, as publish.service.ts keeps beside it. */
const gitDir = () => {
  const dir = fs.mkdtempSync(path.join(__dirname, ".tmp-git-"));
  dirs.push(dir);
  return dir;
};

/** publishSite as the app calls it, recording the requests it makes and the commits it pushes. */
const publish = async (
  sourceDir: string,
  site: PublishedSite | null,
  { authorization = (_pathname: string) => user.authorization, git = gitDir(), pushFails = false } = {},
) => {
  const requests: string[] = [];
  const created: PublishedSite[] = [];
  const pushes: string[] = [];
  const result = await publishSite({
    sourceDir,
    gitDir: git,
    sourceRemote: ({ remote }) => fakeRemote(remote, pushes, pushFails),
    canvas,
    site,
    request: (url, init = {}) => {
      const target = new URL(url, server.url);
      requests.push(`${init.method ?? "GET"} ${target.pathname}`);
      const headers = new Headers(init.headers);
      headers.set("authorization", authorization(target.pathname));
      return fetch(target, { ...init, headers });
    },
    npm: (args, cwd, { env, ...options }) => spawn("npm", args, { ...options, cwd, env: { ...process.env, ...env } }),
    onSiteCreated: async (site) => void created.push(site),
  });
  return { result, requests, created, pushes, git };
};

/** The commit the site's live publish says it was built from. */
const liveCommit = async (siteId: string) =>
  (await server.env.DB.prepare(
    "SELECT source_commit AS commit_ FROM publish WHERE id = (SELECT live_publish_id FROM site WHERE id = ?)",
  )
    .bind(siteId)
    .first<{ commit_: string | null }>())!.commit_;

/** Makes a file of that size in the workspace without writing its bytes. */
const sparse = (dir: string, file: string, bytes: number) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), "");
  fs.truncateSync(path.join(dir, file), bytes);
  return dir;
};

/** Ids and hashes as labels, for snapshots. */
const readable = (value: unknown, names: Record<string, string>) => {
  let text = JSON.stringify(value);
  for (const [id, label] of Object.entries(names)) text = text.replaceAll(id, label);
  return JSON.parse(
    text
      .replace(/\/files\/[0-9a-f]{64}/g, "/files/<sha256>")
      .replace(/\/publishes\/[\w-]+\//g, "/publishes/<publish>/")
      .replace(/-[\w-]{8}\.(js|css)/g, "-[hash].$1"),
  );
};

/** What's live on the site: each file, and whether it's cached for good. */
const liveFiles = async (siteId: string) => {
  // D1 says which publish is live; R2 holds that publish's manifest.
  const { live } = (await server.env.DB.prepare("SELECT live_publish_id AS live FROM site WHERE id = ?")
    .bind(siteId)
    .first<{ live: string }>())!;
  const manifest = (await (await server.env.SITES.get(`sites/${siteId}/m/${live}.json`))!.json()) as {
    files: Record<string, { h: string; i?: true }>;
  };
  const files = Object.fromEntries(
    Object.entries(manifest.files).map(([file, { i }]) => [file.replace(/-[\w-]{8}\.(js|css)$/, "-[hash].$1"), i ? "immutable" : "revalidate"]),
  );
  const read = async (file: string) => (await server.env.SITES.get(`sites/${siteId}/f/${manifest.files[file]!.h}`))!;
  const canvasFile = await (await read("canvas.json")).json();
  // React's development JSX, which only a development build ships.
  const scripts = Object.keys(manifest.files).filter((file) => file.endsWith(".js"));
  const development = (await Promise.all(scripts.map(async (file) => (await read(file)).text()))).some((code) =>
    code.includes("jsxDEV"),
  );
  return { files, canvasFile, development, hashes: manifest.files };
};

let first: PublishedSite;
let firstGit: string;

it("builds the workspace, makes its site, pushes its source and uploads it", async () => {
  const { result, requests, created, pushes, git } = await publish(workspace(), null);
  first = created[0]!;
  firstGit = git;
  const names = { [first.id]: "<site>" };
  expect(pushes).toHaveLength(1);
  expect(await liveCommit(first.id)).toBe(pushes[0]);
  expect(readable({ result: result._unsafeUnwrap(), created, requests }, names)).toMatchInlineSnapshot(`
    {
      "created": [
        {
          "id": "<site>",
          "url": "https://share.test/s/paper-shaders",
        },
      ],
      "requests": [
        "POST /api/sites",
        "POST /api/sites/<site>/source",
        "POST /api/sites/<site>/publishes",
        "POST /api/sites/<site>/publishes/<publish>/plan",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "POST /api/sites/<site>/publishes/<publish>/commit",
      ],
      "result": {
        "url": "https://share.test/s/paper-shaders",
      },
    }
  `);
  expect(await liveFiles(first.id).then(({ files, canvasFile, development }) => ({ files, canvasFile, development }))).toMatchInlineSnapshot(`
    {
      "canvasFile": {
        "components": [
          {
            "name": "Card",
          },
          {
            "name": "Hero Card",
          },
        ],
        "layouts": [
          {
            "componentName": "Card",
            "height": 200,
            "width": 300,
            "x": 10,
            "y": 20,
          },
        ],
        "name": "Paper Shaders",
        "version": 1,
      },
      "development": false,
      "files": {
        "assets/Card-[hash].js": "immutable",
        "assets/Hero_Card-[hash].js": "immutable",
        "assets/a_b-[hash].js": "immutable",
        "assets/index-[hash].css": "immutable",
        "assets/index-[hash].js": "immutable",
        "canvas.json": "revalidate",
        "clip.txt": "revalidate",
        "preview.html": "revalidate",
      },
    }
  `);
}, 60_000);

it("publishes again to the same site, uploading only what changed", async () => {
  const before = await liveFiles(first.id);
  const previous = await liveCommit(first.id);
  const dir = workspace({ "src/components/user-components/Card.tsx": `export default () => <div>Card, edited</div>\n` });
  const { result, requests, created, pushes } = await publish(dir, first, { git: firstGit });
  expect(pushes).toHaveLength(1);
  expect(await liveCommit(first.id)).toBe(pushes[0]);
  expect(pushes[0]).not.toBe(previous);
  const after = await liveFiles(first.id);
  const changed = Object.keys(after.hashes).filter((file) => after.hashes[file]!.h !== before.hashes[file]?.h);
  expect(
    readable({ result: result._unsafeUnwrap(), created, requests, changed }, { [first.id]: "<site>" }),
  ).toMatchInlineSnapshot(`
    {
      "changed": [
        "assets/Card-[hash].js",
        "assets/Hero_Card-[hash].js",
        "assets/a_b-[hash].js",
        "assets/index-[hash].js",
        "preview.html",
      ],
      "created": [],
      "requests": [
        "POST /api/sites/<site>/source",
        "POST /api/sites/<site>/publishes",
        "POST /api/sites/<site>/publishes/<publish>/plan",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "PUT /api/sites/<site>/publishes/<publish>/files/<sha256>",
        "POST /api/sites/<site>/publishes/<publish>/commit",
      ],
      "result": {
        "url": "https://share.test/s/paper-shaders",
      },
    }
  `);
}, 60_000);

it("makes a new site when the server doesn't know the saved one", async () => {
  const { result, requests, created } = await publish(workspace(), { id: "gone", url: "https://share.test/s/gone" });
  const names = { [created[0]!.id]: "<new site>" };
  expect(readable({ result: result._unsafeUnwrap().url === created[0]!.url, requests: requests.slice(0, 4) }, names))
    .toMatchInlineSnapshot(`
      {
        "requests": [
          "POST /api/sites/gone/source",
          "POST /api/sites",
          "POST /api/sites/<new site>/source",
          "POST /api/sites/<new site>/publishes",
        ],
        "result": true,
      }
    `);
}, 60_000);

it("says why when it can't publish", async () => {
  const outcomes = {
    oldRuntime: await publish(workspace({ "node_modules/@antidrawapp/runtime/package.json": `{"version":"0.4.2"}` }), null),
    brokenComponent: await publish(workspace({ "src/components/user-components/Card.tsx": `export default () => <div>\n` }), null),
    // Sparse: 40 MB as far as the size goes, without writing them.
    fileTooBig: await publish(sparse(workspace(), "public/demo.mov", 40 * 1024 * 1024), null),
    signedOut: await publish(workspace(), null, { authorization: () => "Bearer nobody" }),
    pushRefused: await publish(workspace(), first, { git: firstGit, pushFails: true }),
    // Signed out elsewhere once the publish has started.
    signedOutMidUpload: await publish(workspace(), first, {
      git: firstGit,
      authorization: (pathname) => (pathname.endsWith("/plan") ? "Bearer nobody" : user.authorization),
    }),
  };
  expect(
    readable(
      Object.fromEntries(
        Object.entries(outcomes).map(([name, { result, requests }]) => {
          const { code, message } = result._unsafeUnwrapErr();
          return [name, { code, message, requests }];
        }),
      ),
      { [first.id]: "<site>" },
    ),
  ).toMatchInlineSnapshot(`
    {
      "brokenComponent": {
        "code": "BUILD_FAILED",
        "message": "Couldn't build the workspace
    error during build:
    [vite:esbuild] Transform failed with 1 error:
    src/components/user-components/Card.tsx:2:0: ERROR: Unexpected end of file before a closing "div" tag
    file: src/components/user-components/Card.tsx:2:0

    Unexpected end of file before a closing "div" tag
    1  |  export default () => <div>
    2  |  
       |  ^",
        "requests": [],
      },
      "fileTooBig": {
        "code": "FILE_TOO_LARGE",
        "message": "A file is too big to publish. Each file can be up to 32 MB:
      public/demo.mov (40 MB)
    Delete it or add it to .gitignore, then publish again.",
        "requests": [],
      },
      "oldRuntime": {
        "code": "RUNTIME_TOO_OLD",
        "message": "Publishing needs @antidrawapp/runtime 0.5.0 or later; this workspace has 0.4.2",
        "requests": [],
      },
      "pushRefused": {
        "code": "SOURCE_FAILED",
        "message": "Couldn't save the workspace's source (403: Invalid or expired token). Try publishing again.",
        "requests": [
          "POST /api/sites/<site>/source",
        ],
      },
      "signedOut": {
        "code": "SIGNED_OUT",
        "message": "Not signed in",
        "requests": [
          "POST /api/sites",
        ],
      },
      "signedOutMidUpload": {
        "code": "SIGNED_OUT",
        "message": "Not signed in",
        "requests": [
          "POST /api/sites/<site>/source",
          "POST /api/sites/<site>/publishes",
          "POST /api/sites/<site>/publishes/<publish>/plan",
        ],
      },
    }
  `);
}, 60_000);

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { publishSite, type PublishEvent, type PublishOptions, type PublishedSite } from "../publish";
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

/**
 * The source repo as the server described it, minus git. A push can be
 * refused, or find main moved every time, as when another publish of the site
 * keeps pushing.
 */
const fakeRemote = (remote: string, pushes: string[], fails: "refused" | "moved" | null): SourceRemote => ({
  head: async () => heads.get(remote) ?? null,
  async push(commit, parent) {
    if (fails === "refused") throw new SourcePushError("403: Invalid or expired token");
    if (fails === "moved") throw new SourceMovedError(`main is at ${"1".repeat(40)}`);
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
  {
    authorization = (_pathname: string) => user.authorization,
    git = gitDir(),
    pushFails = null as "refused" | "moved" | null,
    duringBuild = (_dir: string) => {},
    // Changes where a request goes, as a server without that route would see it.
    route = (pathname: string) => pathname,
  } = {},
) => {
  const requests: string[] = [];
  const created: PublishedSite[] = [];
  const pushes: string[] = [];
  const events: PublishEvent[] = [];
  const result = await publishSite({
    sourceDir,
    gitDir: git,
    sourceRemote: ({ remote }) => fakeRemote(remote, pushes, pushFails),
    canvas,
    site,
    request: (url, init = {}) => {
      const target = new URL(route(String(url)), server.url);
      requests.push(`${init.method ?? "GET"} ${target.pathname}`);
      const headers = new Headers(init.headers);
      headers.set("authorization", authorization(target.pathname));
      return fetch(target, { ...init, headers });
    },
    npm: (args, cwd, { env, ...options }) => {
      duringBuild(cwd);
      return spawn("npm", args, { ...options, cwd, env: { ...process.env, ...env } });
    },
    onSiteCreated: async (site) => void created.push(site),
    onEvent: (event) => void events.push(event),
  });
  return { result, requests, created, pushes, git, events };
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
  const { result, requests, created, pushes, git, events } = await publish(workspace(), null);
  // How it went, as the publish panel hears it: each step, what it found
  // (the repo's runtime version, the build's time and size vary), and the
  // upload's last progress.
  const uploads = events.filter((e) => e.type === "upload");
  expect({
    steps: events.flatMap((e) => (e.type === "step" ? [e.step] : e.type === "meta" ? [`${e.step}: ${{ runtime: "<version>", build: "<time> · <size>" }[e.step as string] ?? e.text}`] : [])),
    builtIn: events.some((e) => e.type === "log" && /^✓ built in /.test(e.line)),
    lastUpload: { ...uploads.at(-1), file: "<file>" },
  }).toMatchInlineSnapshot(`
    {
      "builtIn": true,
      "lastUpload": {
        "done": 8,
        "file": "<file>",
        "total": 8,
        "type": "upload",
        "unchanged": 0,
      },
      "steps": [
        "runtime",
        "runtime: <version>",
        "build",
        "build: <time> · <size>",
        "upload",
        "upload: 8 files",
        "live",
      ],
    }
  `);
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

it("keeps the saved site when a 404 is about the route, not the site", async () => {
  const made = await fetch(new URL("/api/sites", server.url), {
    method: "POST",
    headers: { authorization: user.authorization, "content-type": "application/json" },
    body: JSON.stringify({ title: "Kept" }),
  });
  const site = (await made.json()) as PublishedSite;
  const { result, requests, created } = await publish(workspace(), site, {
    route: (pathname) => pathname.replace(/\/source$/, "/source-gone"),
  });
  expect(
    readable({ error: result._unsafeUnwrapErr(), requests, created }, { [site.id]: "<site>" }),
  ).toMatchInlineSnapshot(`
    {
      "created": [],
      "error": {
        "code": "SERVER_ERROR",
        "message": "Not found",
        "status": 502,
      },
      "requests": [
        "POST /api/sites/<site>/source-gone",
      ],
    }
  `);
}, 60_000);

it("says why when it can't publish", async () => {
  const outcomes = {
    oldRuntime: await publish(workspace({ "node_modules/@antidrawapp/runtime/package.json": `{"version":"0.4.2"}` }), null),
    brokenComponent: await publish(workspace({ "src/components/user-components/Card.tsx": `export default () => <div>\n` }), null),
    // Sparse: 40 MB as far as the size goes, without writing them.
    fileTooBig: await publish(sparse(workspace(), "public/demo.mov", 40 * 1024 * 1024), null),
    // Saved while it built: an edit, and a new file.
    changedWhileBuilding: await publish(workspace(), null, {
      duringBuild: (dir) => {
        fs.appendFileSync(path.join(dir, "src/components/user-components/Card.tsx"), "\n// edited\n");
        fs.writeFileSync(path.join(dir, "src/components/user-components/New.tsx"), "export default () => null\n");
      },
    }),
    signedOut: await publish(workspace(), null, { authorization: () => "Bearer nobody" }),
    pushRefused: await publish(workspace(), first, { git: firstGit, pushFails: "refused" }),
    // Another publish of the site pushes before ours each time.
    pushRaced: await publish(workspace(), first, { git: firstGit, pushFails: "moved" }),
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
        "message": "Couldn't build the workspace.
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
      "changedWhileBuilding": {
        "code": "SOURCE_CHANGED",
        "message": "src/components/user-components/Card.tsx, src/components/user-components/New.tsx changed while publishing. Publish again to include the changes.",
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
        "message": "This workspace has @antidrawapp/runtime 0.4.2. Publishing needs 0.5.0 or later.",
        "requests": [],
      },
      "pushRaced": {
        "code": "SOURCE_FAILED",
        "message": "This site is being published from somewhere else too. Publish again once that's done.",
        "requests": [
          "POST /api/sites/<site>/source",
        ],
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

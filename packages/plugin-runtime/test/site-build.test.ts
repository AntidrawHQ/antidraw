import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { ReactElement } from "react"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { build, createLogger, createServer, mergeConfig, type InlineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { antidraw } from "@antidrawapp/runtime/plugin"

// `vite build` of a workspace (test/fixture) with the runtime plugin, as the
// app runs it to publish: the site it writes, and what it must not contain.

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "fixture")
const runtimeRoot = path.resolve(here, "..")

// Rollup's content hashes change with any dependency; the snapshots don't.
const unhash = (file: string) => file.replace(/-[\w-]{8}\.(js|css)$/, "-[hash].$1")

const listFiles = (dir: string, prefix = ""): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  )

// A production build, as `vite build` makes one (Vitest sets NODE_ENV=test),
// and the warnings it logged.
const buildSite = async (root: string, overrides: InlineConfig = {}, nodeEnv = "production") => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidraw-site-"))
  const warnings: string[] = []
  const logger = createLogger("silent")
  logger.warn = (message) => warnings.push(message)
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  try {
    await build(
      mergeConfig(
        {
          root,
          configFile: false,
          customLogger: logger,
          plugins: [react(), ...antidraw()],
          build: { outDir, emptyOutDir: true },
        },
        overrides,
      ),
    )
  } finally {
    process.env.NODE_ENV = previous
  }
  return { outDir, warnings }
}

// A copy of the fixture inside this package, so it still resolves the repo's
// node_modules, with some files changed.
const fixtureWith = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(here, ".tmp-"))
  fs.cpSync(fixture, dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

describe("the site a build writes", () => {
  let site: string
  let warnings: string[]
  const read = (file: string) => fs.readFileSync(path.join(site, file), "utf8")
  const manifest = () =>
    JSON.parse(read(".vite/manifest.json")) as Record<
      string,
      { file: string; css?: string[]; assets?: string[] }
    >

  beforeAll(async () => {
    ;({ outDir: site, warnings } = await buildSite(fixture))
  })
  afterAll(() => fs.rmSync(site, { recursive: true, force: true }))

  test("logs no warnings", () => {
    expect(warnings).toEqual([])
  })

  test("is the Preview page, a chunk per component, and the public files", () => {
    expect(listFiles(site).map(unhash).sort()).toMatchInlineSnapshot(`
      [
        ".vite/manifest.json",
        "assets/Card-[hash].js",
        "assets/Hero_Card-[hash].js",
        "assets/a_b-[hash].js",
        "assets/index-[hash].css",
        "assets/index-[hash].js",
        "clip.txt",
        "preview.html",
      ]
    `)
  })

  test("serves the page as preview.html, with root-absolute asset URLs", () => {
    expect(read("preview.html").replace(/-[\w-]{8}\.(js|css)/g, "-[hash].$1"))
      .toMatchInlineSnapshot(`
        "<!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Fixture</title>
            <script type="module" crossorigin src="/assets/index-[hash].js"></script>
            <link rel="stylesheet" crossorigin href="/assets/index-[hash].css">
          </head>
          <body>
            <div id="root"></div>
          </body>
        </html>
        "
      `)
  })

  test("loads each component file by name", () => {
    // The glob the build puts in place of the dev loader, as Vite expanded it.
    const entry = manifest()["index.html"]!.file
    const names = [...read(entry).matchAll(/"\/src\/components\/user-components\/([^"]+)\.tsx"/g)]
      .map((m) => m[1])
      .sort()
    expect(names).toMatchInlineSnapshot(`
      [
        "Card",
        "Hero Card",
        "a&b",
      ]
    `)
  })

  test("lists every content-hashed file in the manifest, and nothing else", () => {
    const hashed = new Set(
      Object.values(manifest()).flatMap((chunk) => [
        chunk.file,
        ...(chunk.css ?? []),
        ...(chunk.assets ?? []),
      ]),
    )
    expect([...hashed].map(unhash).sort()).toMatchInlineSnapshot(`
      [
        "assets/Card-[hash].js",
        "assets/Hero_Card-[hash].js",
        "assets/a_b-[hash].js",
        "assets/index-[hash].css",
        "assets/index-[hash].js",
      ]
    `)
  })

  test("has no source maps and none of this machine's paths", () => {
    const files = listFiles(site)
    const containing = (...needles: string[]) =>
      files.filter((f) => needles.some((needle) => read(f).includes(needle)))
    expect({
      sourceMaps: files.filter((f) => f.endsWith(".map")),
      localPaths: containing(fixture, runtimeRoot, os.homedir()),
      // plugin-react's development JSX, which carries each source file's path.
      developmentJsx: containing("jsxDEV"),
    }).toMatchInlineSnapshot(`
      {
        "developmentJsx": [],
        "localPaths": [],
        "sourceMaps": [],
      }
    `)
  })
})

test("a component that doesn't compile fails the build, naming its file", async () => {
  const root = fixtureWith({
    "src/components/user-components/Broken.tsx": "export default function Broken() { return <div> }\n",
  })
  try {
    const failure = await buildSite(root).then(
      () => null,
      (error: Error & { id?: string }) => ({
        id: error.id?.replaceAll(root, "<root>"),
        // The summary and esbuild's errors; the code frames follow.
        message: error.message.replaceAll(root, "<root>").split("\n").slice(0, 3),
      }),
    )
    expect(failure).toMatchInlineSnapshot(`
      {
        "id": "<root>/src/components/user-components/Broken.tsx",
        "message": [
          "[vite:esbuild] Transform failed with 2 errors:",
          "<root>/src/components/user-components/Broken.tsx:1:48: ERROR: The character "}" is not valid inside a JSX element",
          "<root>/src/components/user-components/Broken.tsx:2:0: ERROR: Unexpected end of file before a closing "div" tag",
        ],
      }
    `)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("keeps its base, assets folder and no source maps over a workspace's own", async () => {
  const { outDir } = await buildSite(fixture, {
    base: "./",
    build: { assetsDir: "static", sourcemap: true },
  })
  try {
    const page = fs.readFileSync(path.join(outDir, "preview.html"), "utf8")
    expect({
      files: listFiles(outDir).map(unhash).sort(),
      pageUrls: [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => unhash(m[1]!)),
    }).toMatchInlineSnapshot(`
      {
        "files": [
          ".vite/manifest.json",
          "assets/Card-[hash].js",
          "assets/Hero_Card-[hash].js",
          "assets/a_b-[hash].js",
          "assets/index-[hash].css",
          "assets/index-[hash].js",
          "clip.txt",
          "preview.html",
        ],
        "pageUrls": [
          "/assets/index-[hash].js",
          "/assets/index-[hash].css",
        ],
      }
    `)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test("the built loader loads each component by name, and rejects any other name", async () => {
  // The site's entry renders into a page, so this builds the loader on its own,
  // as an entry that exports it, and runs it here. Module preloading is off:
  // it adds <link> tags to the page's document, which Node doesn't have.
  const root = fixtureWith({
    "src/probe.ts": 'export { loadComponent } from "../../../src/load-component"\n',
  })
  const { outDir } = await buildSite(root, {
    build: {
      modulePreload: false,
      rollupOptions: { input: path.join(root, "src/probe.ts"), preserveEntrySignatures: "exports-only" },
    },
  })
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, ".vite/manifest.json"), "utf8"))
    const { loadComponent } = await import(
      pathToFileURL(path.join(outDir, manifest["src/probe.ts"].file)).href
    )
    const loaded = await Promise.allSettled(
      ["Card", "Hero Card", "a&b", "Nope"].map((name) => loadComponent(name)),
    )
    expect(
      loaded.map((result) => {
        if (result.status === "rejected") return (result.reason as Error).message
        const element = (result.value.default as () => ReactElement)()
        return { type: element.type, props: element.props }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "props": {
            "children": "Card",
            "className": "card",
          },
          "type": "div",
        },
        {
          "props": {
            "alt": "Hero",
            "src": "/clip.txt",
          },
          "type": "img",
        },
        {
          "props": {
            "children": "a&b",
          },
          "type": "p",
        },
        "No component named "Nope"",
      ]
    `)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test("fails when the build doesn't swap the loader", async () => {
  // A page without this copy of the runtime's Preview page, as when it comes
  // from another copy of the runtime, would publish no components.
  const root = fixtureWith({ "src/main.tsx": 'import "./index.css"\n' })
  try {
    const failure = await buildSite(root).then(
      () => null,
      (error: Error) => error.message.replaceAll(fs.realpathSync(runtimeRoot), "<runtime>"),
    )
    expect(failure).toMatchInlineSnapshot(`"[antidraw:site-build] [plugin antidraw:site-build] The Preview page's component loader (<runtime>/src/load-component.ts) was not part of this build, so the site would load no components. Check that the page imports the router from this copy of @antidrawapp/runtime, and that resolve.preserveSymlinks is not set."`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("warns when NODE_ENV makes it a development build", async () => {
  const { outDir, warnings } = await buildSite(fixture, {}, "development")
  fs.rmSync(outDir, { recursive: true, force: true })
  expect(warnings.filter((w) => w.includes("[antidraw]"))).toMatchInlineSnapshot(`
    [
      "[antidraw] NODE_ENV is not "production", so this is a development build. Run it with NODE_ENV=production to publish it.",
    ]
  `)
})

test("the dev server still loads components from disk by name", async () => {
  const server = await createServer({
    root: fixture,
    configFile: false,
    logLevel: "silent",
    plugins: [react(), ...antidraw()],
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, entries: [] },
  })
  try {
    const loader = await server.transformRequest(path.join(runtimeRoot, "src/load-component.ts"))
    expect(loader?.code).toMatchInlineSnapshot(`
      "export const loadComponent = (name) => import(
        /* @vite-ignore */
        \`/src/components/user-components/\${encodeURIComponent(name)}.tsx\`
      );
      "
    `)
  } finally {
    await server.close()
  }
})

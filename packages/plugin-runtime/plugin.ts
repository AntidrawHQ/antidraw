import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { parse } from "@babel/parser"
import MagicString from "magic-string"
import { normalizePath, transformWithEsbuild } from "vite"
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite"
import { SOURCE_ATTRIBUTE, USE_ATTRIBUTE } from "./src/inspector/protocol"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const certsDir = path.resolve(__dirname, "../certs")

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|html)$/
const SCANNABLE_FILE_RE = /\.(m?[jt]s|[jt]sx)$/
const USER_COMPONENTS_DIR = "src/components/user-components"
const BARE_IMPORT_RE = /^[\w@][^:]/
const JSX_FILE_RE = /\.[jt]sx$/

// Tailwind v4 compiles CSS lazily inside the transform of index.css, and Vite
// caches that transform in its module graph. Files scanned during the last
// compile are watched individually, so *edits* invalidate correctly — but a
// *new* file has no watch mapping, and Tailwind's glob registrations are dead
// entries under Vite 7 (chokidar v4 dropped glob support). Without this hook,
// a component file created while the dev server runs renders with its utility
// classes missing until index.css is touched or the server restarts.
const cssInvalidateOnFileAdd = (): Plugin => {
  let server: ViteDevServer
  let timer: ReturnType<typeof setTimeout> | undefined

  const reloadCssModules = () => {
    for (const mod of server.moduleGraph.idToModuleMap.values()) {
      if (!mod.file) continue
      if (!mod.file.endsWith(".css")) continue
      if (mod.file.includes("node_modules")) continue
      // Hot-swaps just the stylesheet module — no full page reload
      void server.reloadModule(mod)
    }
  }

  return {
    name: "antidraw:css-invalidate-on-file-add",
    apply: "serve",
    configureServer(devServer) {
      server = devServer
      const srcDir = path.join(devServer.config.root, "src")

      const onFileAddedOrRemoved = (file: string) => {
        if (!file.startsWith(srcDir + path.sep)) return
        if (!SOURCE_FILE_RE.test(file)) return
        // Debounce: agents often write several files in one burst
        clearTimeout(timer)
        timer = setTimeout(reloadCssModules, 150)
      }

      devServer.watcher.on("add", onFileAddedOrRemoved)
      devServer.watcher.on("unlink", onFileAddedOrRemoved)
    },
  }
}

// Is this a workspace source file the dependency scanner crawls? Everything
// reachable from the scan entries (see `optimizeDeps.entries` below) lives
// under the workspace root; dependencies are externalised, not crawled, so a
// node_modules path only shows up here for linked packages.
const isWorkspaceSource = (root: string, file: string) => {
  const normalized = normalizePath(file)
  return (
    normalized.startsWith(normalizePath(root) + "/") &&
    !normalized.includes("/node_modules/")
  )
}

// User components are dependency-scan entries, so the scanner crawls every
// workspace source file they reach: the components themselves, and helpers
// under src/lib, src/components/ui, hooks, and so on. A bare import in any of
// those files that Vite cannot resolve (a package that is not installed)
// makes Vite abort the whole scan and skip pre-bundling for the workspace —
// every preview then rediscovers its packages from the browser, with a
// re-bundle and a full reload each time. This hook runs after Vite's own
// resolver, only during the scan, and only for imports made by workspace
// source: an import Vite could not resolve is handed back unchanged, which
// the scanner treats as external. The pre-bundle stays complete and only the
// previews that load that file fail, with Vite's usual "Failed to resolve
// import" error. Relative imports never reach here: the scanner externalises
// unresolved ones on its own. Nor do "@/…" aliases: the alias plugin returns
// the rewritten absolute path even when no file exists there, so an
// extensionless miss is externalised as non-scannable and a miss with a
// JS/TS extension is handed to the loader, where the hook below catches it.
const tolerateUnresolvedImports = (): Plugin => {
  let config: ResolvedConfig
  const warned = new Set<string>()

  return {
    name: "antidraw:tolerate-unresolved-imports",
    apply: "serve",
    enforce: "post",
    configResolved(resolved) {
      config = resolved
    },
    resolveId(id, importer, options) {
      // Vite passes `scan: true` while the dependency scanner resolves, but the
      // public hook type does not declare it.
      if (!(options as { scan?: boolean }).scan) return null
      if (!importer || !isWorkspaceSource(config.root, importer)) return null
      if (!BARE_IMPORT_RE.test(id) || id.includes("\0")) return null
      const key = `${importer}\0${id}`
      if (!warned.has(key)) {
        warned.add(key)
        config.logger.warn(
          `[antidraw] "${id}" (imported by ${path.relative(config.root, importer)}) ` +
            "could not be resolved and was left out of the dependency pre-bundle. Is it installed?",
        )
      }
      return { id }
    },
  }
}

// The other ways a workspace source file can abort the dependency scan:
// esbuild cannot parse it, or it does not exist (an "@/…" alias with an
// extension to a file not written yet resolves to a path all the same). The
// scanner runs `optimizeDeps.esbuildOptions.plugins` ahead of its own loader,
// so this onLoad reads and parses each workspace source file first and, if
// either fails, hands the scanner an empty module (with a warning naming the
// file) so the rest of the workspace is still pre-bundled. Only the previews
// that load that file fail, with Vite's usual error. The same plugin list is
// used when the optimizer bundles dependencies, where no workspace source is
// loaded, so the prefix check makes it a no-op there.
const tolerateUnparsableSource = (): Plugin => {
  let config: ResolvedConfig

  return {
    name: "antidraw:tolerate-unparsable-source",
    apply: "serve",
    configResolved(resolved) {
      config = resolved
    },
    config: () => ({
      optimizeDeps: {
        esbuildOptions: {
          plugins: [
            {
              name: "antidraw:tolerate-unparsable-source",
              setup(build) {
                build.onLoad({ filter: SCANNABLE_FILE_RE }, async (args) => {
                  if (!isWorkspaceSource(config.root, args.path)) return undefined
                  const file = path.relative(config.root, args.path)
                  try {
                    const code = await fs.promises.readFile(args.path, "utf8")
                    await transformWithEsbuild(code, args.path)
                    return undefined
                  } catch (e) {
                    const err = e as NodeJS.ErrnoException
                    let reason: string
                    if (err.code === "ENOENT") {
                      reason = `${file} does not exist`
                    } else {
                      // esbuild's message is a count line followed by one
                      // "file:line:col: ERROR: …" line per error; show the first.
                      const lines = err.message.split("\n")
                      reason = `${file} could not be parsed: ${lines[1]?.trim() || lines[0]}`
                    }
                    config.logger.warn(
                      `[antidraw] ${reason} — left out of the dependency scan`,
                    )
                    return { contents: "", loader: "js" }
                  }
                })
              },
            },
          ],
        },
      },
    }),
  }
}

// Stamps each element in the workspace's JSX with where it is written, for
// the canvas's inspector: <div className="card"> becomes
// <div data-ad-loc="src/components/user-components/Card.tsx:12:5" className="card">.
// An element that renders a DOM node (<div>, <motion.div>) gets data-ad-loc.
// A component (<Button>) gets data-ad-use, where it's used: just another
// prop, which reaches the DOM where the component passes its props on, as
// shadcn's do ({...props}). Put ahead of the element's own attributes, a
// caller's spread replaces it, so the DOM node carries the outermost use
// that got through. Fragments take no props. Dev server only: a build would
// publish this machine's file layout.
const tagSource = (): Plugin => {
  let root: string

  type Node = { type: string; start: number; end: number; [key: string]: unknown }
  const isNode = (v: unknown): v is Node => !!v && typeof v === "object" && typeof (v as Node).type === "string"
  const visit = (node: Node, fn: (node: Node) => void) => {
    fn(node)
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || !value || typeof value !== "object") continue
      if (Array.isArray(value)) value.forEach((child) => isNode(child) && visit(child, fn))
      else if (isNode(value)) visit(value, fn)
    }
  }
  // The stamp an element's name takes: lowercase renders a DOM node, as does
  // a member ending in one (motion.div); other names are components.
  const stampFor = (name: Node): string | null => {
    if (name.type === "JSXMemberExpression") return stampFor(name.property as Node)
    if (name.type !== "JSXIdentifier") return null
    if (/^[a-z]/.test(name.name as string)) return SOURCE_ATTRIBUTE
    return name.name === "Fragment" ? null : USE_ATTRIBUTE
  }

  return {
    name: "antidraw:tag-source",
    apply: "serve",
    // Ahead of plugin-react, on the file as written. enforce alone isn't
    // enough: plugin-react's Babel pass is "pre" too, and workspaces list
    // react() first. A "pre" hook runs before every hook that isn't.
    enforce: "pre",
    configResolved(config) {
      root = config.root
    },
    transform: {
      order: "pre",
      handler(code, id) {
        const file = id.split("?")[0]!
        if (!JSX_FILE_RE.test(file) || !isWorkspaceSource(root, file)) return null
        let ast
        try {
          ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true })
        } catch {
          // plugin-react reports the syntax error.
          return null
        }
        const relative = normalizePath(path.relative(root, file))
        // Line and column as editors and the agent's Read tool count them: lines
        // end only at \n (or \r\n). Babel's loc also ends them at a lone \r,
        // U+2028 and U+2029, so text pasted with one would put every element
        // after it a line too low. A byte order mark isn't a column.
        const lineStarts = [0]
        for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) lineStarts.push(i + 1)
        const bom = code.charCodeAt(0) === 0xfeff ? 1 : 0
        const position = (offset: number) => {
          let lo = 0
          let hi = lineStarts.length - 1
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (lineStarts[mid]! <= offset) lo = mid
            else hi = mid - 1
          }
          return { line: lo + 1, column: offset - lineStarts[lo]! + 1 - (lo === 0 ? bom : 0) }
        }
        const s = new MagicString(code)
        visit(ast.program as unknown as Node, (node) => {
          if (node.type !== "JSXOpeningElement") return
          const stamp = stampFor(node.name as Node)
          if (!stamp) return
          const attributes = node.attributes as Node[]
          const named = (a: Node) => a.type === "JSXAttribute" && (a.name as Node & { name: unknown }).name === stamp
          if (attributes.some(named)) return
          const { line, column } = position(node.start)
          // After the name and any type arguments (<motion.div<Props>>).
          const after = ((node.typeArguments ?? node.typeParameters ?? node.name) as Node).end
          s.appendLeft(after, ` ${stamp}={${JSON.stringify(`${relative}:${line}:${column}`)}}`)
        })
        if (!s.hasChanged()) return null
        return { code: s.toString(), map: s.generateMap({ hires: "boundary", source: file, includeContent: true }) }
      },
    },
  }
}

// Vite decodes request paths with decodeURI, which leaves URL-reserved
// characters (& ; : @ = + $ ,) percent-encoded, so a source file whose name
// contains one cannot be requested: the lookup misses and the SPA fallback
// answers instead. The Preview page requests components by their
// percent-encoded name, so decode those characters for workspace source
// requests. "/", "?" and "#" stay impossible: decoded, they would change the
// URL's meaning.
const RESERVED_ESCAPE_RE = /%(26|3B|3A|40|3D|2B|24|2C)/gi

const decodeReservedInSourcePaths = (): Plugin => ({
  name: "antidraw:decode-reserved-in-source-paths",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith("/src/") && RESERVED_ESCAPE_RE.test(req.url)) {
        req.url = req.url.replace(RESERVED_ESCAPE_RE, (m) => decodeURIComponent(m))
      }
      next()
    })
  },
})

// The Preview page's dev loader, which a build replaces (see siteBuild).
const LOAD_COMPONENT_FILE = path.resolve(__dirname, "../src/load-component.ts")

// What the Preview page loads components with in a build. There is no dev
// server to fetch a file by name from, so every component file becomes its own
// lazily loaded chunk, looked up by name. The glob path is from the workspace
// root, not from this module. A name with no file rejects, as a failed import
// does in dev, and the Preview page shows it as not found.
const BUILD_LOAD_COMPONENT = `
const components = import.meta.glob("/${USER_COMPONENTS_DIR}/*.tsx")
export const loadComponent = (name) => {
  const load = components["/${USER_COMPONENTS_DIR}/" + name + ".tsx"]
  return load ? load() : Promise.reject(new Error("No component named " + JSON.stringify(name)))
}
`

// `vite build` makes the workspace's site: the Preview page and every
// component, served from the root of its own origin (components refer to
// their public files by absolute path, "/clip.mp4"). The page is written as
// preview.html, which the site serves at /preview, the runtime's only route.
// The manifest (.vite/manifest.json) lists the content-hashed files, which a
// host can cache for good. No source maps: they would publish this machine's
// paths.
const siteBuild = (): Plugin => {
  let loadComponentFile: string
  let loaderReplaced = false

  return {
    name: "antidraw:site-build",
    apply: "build",
    enforce: "post",
    config: () => ({
      base: "/",
      build: {
        assetsDir: "assets",
        manifest: true,
        sourcemap: false,
        rollupOptions: {
          // Chunks are named after their component files. Keep those names
          // to characters a URL carries as they are ("Hero Card.tsx" would
          // otherwise be served as assets/Hero Card-[hash].js).
          output: { sanitizeFileName: (name) => name.replace(/[^\w.\/-]/g, "_") },
        },
      },
    }),
    configResolved(config) {
      loadComponentFile = normalizePath(fs.realpathSync(LOAD_COMPONENT_FILE))
      // NODE_ENV from a workspace .env wins over `vite build`'s own, and a
      // development build ships React's development build and the path of
      // every source file (plugin-react's jsxDEV).
      if (!config.isProduction) {
        config.logger.warn(
          "[antidraw] NODE_ENV is not \"production\", so this is a development build. " +
            "Run it with NODE_ENV=production to publish it.",
        )
      }
    },
    buildStart() {
      loaderReplaced = false
    },
    load(id) {
      if (normalizePath(id) !== loadComponentFile) return
      loaderReplaced = true
      return BUILD_LOAD_COMPONENT
    },
    // Without the swap the build still succeeds, but the site has no
    // component chunks and every preview shows "not found". The loader's id
    // differs from this plugin's copy when the Preview page comes from another
    // copy of the runtime, or with resolve.preserveSymlinks.
    buildEnd(error) {
      if (error || loaderReplaced) return
      this.error(
        `The Preview page's component loader (${loadComponentFile}) was not ` +
          "part of this build, so the site would load no components. Check that the " +
          "page imports the router from this copy of @antidrawapp/runtime, and that " +
          "resolve.preserveSymlinks is not set.",
      )
    },
    generateBundle(_, bundle) {
      const page = bundle["index.html"]
      if (!page) return
      delete bundle["index.html"]
      page.fileName = "preview.html"
      bundle["preview.html"] = page
    },
  }
}

export const antidraw = (): Plugin[] => {
  return [
    siteBuild(),
    tagSource(),
    cssInvalidateOnFileAdd(),
    decodeReservedInSourcePaths(),
    tolerateUnresolvedImports(),
    tolerateUnparsableSource(),
    {
      name: "antidraw:config",
      config: () => ({
        server: {
          https: {
            key: fs.readFileSync(path.join(certsDir, "localhost.key")),
            cert: fs.readFileSync(path.join(certsDir, "localhost.crt")),
          },
        },
        resolve: {
          alias: {
            "@": path.resolve(process.cwd(), "./src"),
          },
          dedupe: ["react", "react-dom", "@tanstack/react-router"],
        },
        optimizeDeps: {
          // The Preview page loads a component through a dynamic import built
          // from its name, which the dependency scanner cannot follow, so the
          // packages only a component imports were discovered when the browser
          // first loaded it. Each discovery re-bundled under the running page,
          // and react-dom from one bundle met React from the next: a burst of
          // "Invalid hook call" errors on every cold start until the reload
          // landed. Listing the components as scan entries puts their packages
          // in the first bundle. This covers components present when the
          // server starts; a package first imported later is still discovered
          // by the browser and triggers one re-bundle. An explicit entry list
          // replaces the default index.html crawl, so index.html is listed too.
          entries: ["index.html", `${USER_COMPONENTS_DIR}/*.tsx`],
        },
      }),
    },
  ]
}

export default antidraw

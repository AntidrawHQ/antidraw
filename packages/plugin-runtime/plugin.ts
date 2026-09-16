import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { normalizePath, transformWithEsbuild } from "vite"
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const certsDir = path.resolve(__dirname, "../certs")

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|html)$/
const SCANNABLE_FILE_RE = /\.(m?[jt]s|[jt]sx)$/
const USER_COMPONENTS_DIR = "src/components/user-components"
const BARE_IMPORT_RE = /^[\w@][^:]/

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

export const antidraw = (): Plugin[] => {
  return [
    cssInvalidateOnFileAdd(),
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

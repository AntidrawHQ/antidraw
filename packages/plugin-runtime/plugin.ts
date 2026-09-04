import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Plugin, ViteDevServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runtimeSrc = path.resolve(__dirname, "../src")
const certsDir = path.resolve(__dirname, "../certs")

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|html)$/

const SCAN_FILE_RE = /\.(ts|tsx|js|jsx)$/
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git", "dist"])
// A specifier Vite could not pre-bundle anyway: assets, styles, query suffixes.
const NON_JS_SPECIFIER_RE = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|json|woff2?|ttf|otf|mp[34]|webm|wav)$/i
// `import type { A } from "x"`, `import type A from "x"`, `import type * as A
// from "x"`, and the `export type` re-export form. A type alias declaration
// (`export type A = ...`) has no `from` clause and must not match.
const TYPE_ONLY_IMPORT_RE =
  /(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s*from\s*['"][^'"]+['"]/g
const SPECIFIER_RE = /\b(?:from|import)\s*\(?\s*['"]([^'"\s]+)['"]/g

const listSourceFiles = (dir: string, out: string[] = []): string[] => {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SCAN_SKIP_DIRS.has(entry.name)) listSourceFiles(full, out)
    } else if (SCAN_FILE_RE.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const isBareSpecifier = (spec: string): boolean => {
  if (spec.includes("?")) return false
  if (/^(\.|\/|@\/|~|virtual:|node:|data:|https?:)/.test(spec)) return false
  if (NON_JS_SPECIFIER_RE.test(spec)) return false
  return true
}

const packageNameOf = (spec: string): string => {
  const parts = spec.split("/")
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

// Vite only pre-bundles what its startup crawl reaches, and the crawl here
// covers the runtime source alone: user components are loaded lazily by the
// Preview page from a dynamic specifier, so their dependencies are found only
// when the page first imports them. Each late discovery re-optimizes and
// bumps the dep hash under a page that is already half-loaded, leaving react
// and react-dom from different bundles — every hook then fails with "Invalid
// hook call". Crawling `src/**` instead is not an option: one component with
// a syntax error makes esbuild abort the whole scan, and this is a directory
// agents write into. So the plugin scans the source itself, with a regex that
// does not care whether a file parses, and hands every installed package it
// finds to optimizeDeps.include so the first bundle already has all of them.
const collectWorkspaceDeps = (root: string): string[] => {
  const found = new Set<string>()
  for (const file of listSourceFiles(path.join(root, "src"))) {
    let source: string
    try {
      source = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    source = source.replace(TYPE_ONLY_IMPORT_RE, "")
    for (const match of source.matchAll(SPECIFIER_RE)) {
      const spec = match[1]
      if (!isBareSpecifier(spec)) continue
      const manifest = path.join(root, "node_modules", packageNameOf(spec), "package.json")
      if (fs.existsSync(manifest)) found.add(spec)
    }
  }
  return [...found].sort()
}

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

export const antidraw = (): Plugin[] => {
  return [
    cssInvalidateOnFileAdd(),
    {
      name: "antidraw:config",
      config: (userConfig) => ({
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
          // Scan runtime source to auto-discover CJS deps needing pre-bundling
          entries: [runtimeSrc + "/**"],
          include: collectWorkspaceDeps(path.resolve(userConfig.root ?? process.cwd())),
        },
      }),
    },
  ]
}

export default antidraw

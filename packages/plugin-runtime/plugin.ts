import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { parse } from "@babel/parser"
import type { JSXOpeningElement, Node } from "@babel/types"
import MagicString from "magic-string"
import type { Plugin, ViteDevServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runtimeSrc = path.resolve(__dirname, "../src")
const certsDir = path.resolve(__dirname, "../certs")

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|html)$/

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

export const SOURCE_ATTR = "data-antidraw-source"

const JSX_FILE_RE = /\.[jt]sx$/

const collectJsxOpeningElements = (
  node: Node | Node[] | null | undefined,
  out: JSXOpeningElement[],
) => {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) collectJsxOpeningElements(child, out)
    return
  }
  if (!("type" in node)) return
  if (node.type === "JSXOpeningElement") out.push(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc") continue
    collectJsxOpeningElements(value as Node | Node[] | null, out)
  }
}

// Stamps every JSX element in workspace source with its origin as
// `data-antidraw-source="src/…/File.tsx:line:col"`. The preview's inspect
// mode reads the attribute off clicked DOM nodes, which turns a selection
// into a source location that comments (and later the agent) can anchor to.
// React 19 dropped fiber `_debugSource`, so build-time tagging is the only
// reliable way to recover this mapping. Components receive the attribute as
// a prop; ones that spread rest props (shadcn-style) forward their call
// site's location to the DOM, which is the more useful anchor anyway.
const jsxSourceTagging = (): Plugin => {
  let root = ""

  return {
    name: "antidraw:jsx-source-tagging",
    enforce: "pre",
    apply: "serve",
    configResolved(config) {
      root = config.root
    },
    transform(code, id) {
      const [filename] = id.split("?")
      if (!JSX_FILE_RE.test(filename)) return
      if (filename.includes("/node_modules/")) return
      // Only tag the workspace's own source — linked packages (including the
      // runtime itself) resolve outside root/src and stay untouched
      if (!filename.startsWith(root + "/src/")) return

      let ast: ReturnType<typeof parse>
      try {
        ast = parse(code, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        })
      } catch {
        // Let downstream plugins surface the syntax error
        return
      }

      const elements: JSXOpeningElement[] = []
      collectJsxOpeningElements(ast.program.body, elements)
      if (elements.length === 0) return

      const relPath = path.posix.relative(root, filename)
      const s = new MagicString(code)

      for (const element of elements) {
        if (element.loc == null) continue
        const alreadyTagged = element.attributes.some(
          (attr) =>
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            attr.name.name === SOURCE_ATTR,
        )
        if (alreadyTagged) continue
        // After the type arguments if present (`<Foo<T> …>`), else the name
        const insertAt = element.typeParameters?.end ?? element.name.end
        if (insertAt == null) continue
        const { line, column } = element.loc.start
        s.appendLeft(
          insertAt,
          ` ${SOURCE_ATTR}="${relPath}:${line}:${column + 1}"`,
        )
      }

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true }),
      }
    },
  }
}

export const antidraw = (): Plugin[] => {
  return [
    jsxSourceTagging(),
    cssInvalidateOnFileAdd(),
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
          // Scan runtime source to auto-discover CJS deps needing pre-bundling
          entries: [runtimeSrc + "/**"],
        },
      }),
    },
  ]
}

export default antidraw

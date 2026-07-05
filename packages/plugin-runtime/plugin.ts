import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
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

export const antidraw = (): Plugin[] => {
  return [
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

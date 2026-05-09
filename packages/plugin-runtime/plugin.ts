import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Plugin } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runtimeSrc = path.resolve(__dirname, "../src")
const certsDir = path.resolve(__dirname, "../certs")

export const antidraw = (): Plugin[] => {
  return [
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
    {
      name: "antidraw:tailwind-source",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".css") && code.includes('@import "tailwindcss"')) {
          const workspaceSrc = path.resolve(process.cwd(), "./src")
          // source(...) sets compiler.root rather than adding a side glob,
          // so @tailwindcss/vite's per-id compiler cache invalidates when
          // new files appear under the workspace tree. A separate @source
          // directive only registers watch-deps for files seen during the
          // last generate(), so newly-created user components don't
          // trigger CSS regeneration until the dev server restarts.
          return code.replace(
            '@import "tailwindcss";',
            `@import "tailwindcss" source("${workspaceSrc}");`
          )
        }
      },
    },
  ]
}

export default antidraw

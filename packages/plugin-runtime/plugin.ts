import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runtimeSrc = path.resolve(__dirname, "../src")
const certsDir = path.resolve(__dirname, "../certs")

const VIRTUAL_USER_COMPONENTS = "@antidrawapp/user-components"
const RESOLVED_VIRTUAL_USER_COMPONENTS = "\0@antidrawapp/user-components"

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
      name: "antidraw:user-components",
      resolveId(id) {
        if (id === VIRTUAL_USER_COMPONENTS) {
          return RESOLVED_VIRTUAL_USER_COMPONENTS
        }
      },
      load(id) {
        if (id === RESOLVED_VIRTUAL_USER_COMPONENTS) {
          return `
const modules = import.meta.glob("/src/components/user-components/*.tsx", { eager: true })

export const userComponents = Object.fromEntries(
  Object.entries(modules)
    .map(([path, mod]) => [
      path.replace("/src/components/user-components/", "").replace(".tsx", ""),
      mod.default,
    ])
)
`
        }
      },
    },
    {
      name: "antidraw:tailwind-source",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".css") && code.includes('@import "tailwindcss"')) {
          const workspaceSrc = path.resolve(process.cwd(), "./src")
          return code.replace(
            '@import "tailwindcss";',
            `@import "tailwindcss";\n@source "${workspaceSrc}";`
          )
        }
      },
    },
    ...react(),
    ...tailwindcss(),
  ]
}

export default antidraw

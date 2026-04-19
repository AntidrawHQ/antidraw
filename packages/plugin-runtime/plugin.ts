import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runtimeSrc = path.resolve(__dirname, "../src")
const certsDir = path.resolve(__dirname, "../certs")

const USER_COMPONENTS_DIR = "./src/components/user-components"
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
      name: "antidraw:component-api",
      configureServer: async (server) => {
        const fs = await import("fs/promises")
        const dir = path.resolve(process.cwd(), USER_COMPONENTS_DIR)

        server.middlewares.use("/__components", async (_, res, next) => {
          try {
            const files = await fs.readdir(dir).catch(() => [])

            const components = files
              .filter((f: string) => f.endsWith(".tsx"))
              .map((f: string) => ({ name: f.replace(".tsx", "") }))

            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ components }))
          } catch (err) {
            next(err)
          }
        })

        server.middlewares.use("/__component-source", async (req, res, next) => {
          try {
            const url = new URL(req.url ?? "", "http://localhost")
            const name = url.searchParams.get("name")

            if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
              res.statusCode = 400
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ error: "Invalid or missing component name" }))
              return
            }

            const filePath = path.resolve(dir, `${name}.tsx`)
            const source = await fs.readFile(filePath, "utf-8")

            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ name, fileName: `${name}.tsx`, filePath, source }))
          } catch (err: any) {
            if (err.code === "ENOENT") {
              res.statusCode = 404
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ error: "Component not found" }))
            } else {
              next(err)
            }
          }
        })
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

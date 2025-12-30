import path from "path"
import type { Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const USER_COMPONENTS_DIR = "./src/user-components"
const VIRTUAL_USER_COMPONENTS = "@designsette/user-components"
const RESOLVED_VIRTUAL_USER_COMPONENTS = "\0@designsette/user-components"

export const designsette = (): Plugin[] => {
  return [
    {
      name: "designsette:config",
      config: () => ({
        resolve: {
          alias: {
            "@": path.resolve(process.cwd(), "./src"),
          },
          dedupe: ["react", "react-dom", "@tanstack/react-router"],
        },
      }),
    },
    {
      name: "designsette:user-components",
      resolveId(id) {
        if (id === VIRTUAL_USER_COMPONENTS) {
          return RESOLVED_VIRTUAL_USER_COMPONENTS
        }
      },
      load(id) {
        if (id === RESOLVED_VIRTUAL_USER_COMPONENTS) {
          return `
const modules = import.meta.glob("/src/user-components/*.tsx", { eager: true })

export const userComponents = Object.fromEntries(
  Object.entries(modules)
    .map(([path, mod]) => [
      path.replace("/src/user-components/", "").replace(".tsx", ""),
      mod.default,
    ])
)
`
        }
      },
    },
    {
      name: "designsette:component-api",
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
      },
    },
    ...react(),
    ...tailwindcss(),
  ]
}

export default designsette

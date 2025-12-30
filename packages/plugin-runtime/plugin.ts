import path from "path"
import type { Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const USER_COMPONENTS_DIR = "./src/user-components"

export const designsette = (): Plugin[] => {
  return [
    {
      name: "designsette:config",
      config: () => ({
        resolve: {
          alias: {
            "@": path.resolve(process.cwd(), "./src"),
            "@designsette/user-components": path.resolve(process.cwd(), USER_COMPONENTS_DIR),
          },
        },
      }),
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
              .filter((f: string) => f.endsWith(".tsx") && f !== "index.tsx")
              .map((f: string) => ({ name: f.replace(".tsx", "") }))

            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ components }))
          } catch (err) {
            next(err)
          }
        })
      },
    },
    react(),
    tailwindcss(),
  ]
}

export default designsette

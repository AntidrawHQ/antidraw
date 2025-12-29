import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import fs from "fs/promises";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export type UserComponent = {
  name: string;
};

const userComponentsPlugin = (): Plugin => {
  const USER_COMPONENTS_DIR = "src/user-components";

  const getComponents = async (): Promise<UserComponent[]> => {
    const dir = path.resolve(USER_COMPONENTS_DIR);

    try {
      const files = await fs.readdir(dir);

      return files
        .filter((f) => f.endsWith(".tsx") && f !== "index.tsx")
        .map((f) => f.replace(".tsx", ""))
        .map((name) => ({ name }));
    } catch (err) {
      // Directory doesn't exist or not readable
      return [];
    }
  };

  return {
    name: "antidraw-user-components",
    configureServer: async (server) => {
      server.middlewares.use("/__components", async (_, res, next) => {
        try {
          const components = await getComponents();

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ components }));
        } catch (err) {
          next(err);
        }
      });
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    userComponentsPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

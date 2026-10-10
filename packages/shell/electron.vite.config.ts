import { defineConfig } from "electron-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// Copy generated drizzle migration SQL + journal into dist/main/drizzle/ so the
// runtime migrator (src/main/db/migrate.ts) can resolve them next to the bundle
// in both dev and the packaged asar.
const copyDrizzleMigrations = () => ({
  name: "copy-drizzle-migrations",
  closeBundle: () => {
    const src = path.resolve(__dirname, "src/main/db/drizzle");
    const dest = path.resolve(__dirname, "dist/main/drizzle");
    if (!fs.existsSync(src)) return;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
  },
});

export default defineConfig({
  main: {
    build: {
      outDir: "dist/main",
      watch: {},
      rollupOptions: {
        output: {
          format: "es",
        },
      },
    },
    plugins: [copyDrizzleMigrations()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
  renderer: {
    build: {
      outDir: "dist/renderer",
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom"],
    },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: path.resolve(__dirname, "./src/renderer/routes"),
        generatedRouteTree: path.resolve(
          __dirname,
          "./src/renderer/routeTree.gen.ts"
        ),
      }),
      react(),
      tailwindcss(),
    ],
  },
});

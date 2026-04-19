import { defineConfig } from "electron-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

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

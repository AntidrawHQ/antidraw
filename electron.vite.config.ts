import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  main: {
    build: {
      outDir: "dist/main",
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
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
    plugins: [react(), tailwindcss()],
  },
});

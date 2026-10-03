import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The app half of the share page: a static bundle under /s/, written to
// dist/s/ so that Workers static assets (wrangler.jsonc) serves it at the same
// paths. It borrows the shell's canvas, whose imports use the shell's @ alias.
export default defineConfig({
  base: "/s/",
  resolve: {
    alias: { "@": path.resolve(__dirname, "../shell/src") },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist/s",
    emptyOutDir: true,
    // React, React Flow and motion in one chunk.
    chunkSizeWarningLimit: 1024,
  },
  // SHARE_URL_PATTERN in the server's .dev.vars.example.
  server: { port: 8786, strictPort: true },
  plugins: [react(), tailwindcss()],
});

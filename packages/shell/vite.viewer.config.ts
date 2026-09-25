import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// The published viewer (src/viewer): the shell's canvas as a standalone web
// page. `npm run build:viewer` writes it to dist-viewer (not dist/, which
// electron-builder packs into the app), and scripts/site.ts copies it into
// each published site. Its assets go under _antidraw/ so they cannot collide
// with the workspace build's assets/ next to them.
//
// `SITE=<built site dir> npm run dev:viewer` serves the viewer with HMR, and
// everything else (canvas.json, /preview, the workspace's files) from a site
// that `npm run site:build` already produced.
// Enough for the page to run (module scripts need a JavaScript type); media
// plays without one.
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

const serveBuiltSite = (): Plugin => ({
  name: "antidraw:serve-built-site",
  apply: "serve",
  configureServer(server) {
    const site = process.env.SITE;
    if (!site) return;
    const root = path.resolve(site);
    server.middlewares.use((req, res, next) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const file =
        pathname === "/preview"
          ? path.join(root, "preview.html")
          : path.join(root, pathname);
      if (pathname === "/" || pathname === "/index.html") return next();
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return next();
      if (!fs.statSync(file).isFile()) return next();
      const type = CONTENT_TYPES[path.extname(file)];
      if (type) res.setHeader("Content-Type", type);
      fs.createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  root: path.resolve(__dirname, "src/viewer"),
  base: "/",
  publicDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.resolve(__dirname, "dist-viewer"),
    emptyOutDir: true,
    assetsDir: "_antidraw",
    // React, React Flow and motion in one chunk: ~540 kB, ~175 kB gzipped.
    chunkSizeWarningLimit: 1024,
  },
  plugins: [react(), tailwindcss(), serveBuiltSite()],
});

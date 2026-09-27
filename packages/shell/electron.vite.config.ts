import { defineConfig } from "electron-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build, type Plugin } from "vite";
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

// What Publish needs next to the main bundle (src/main/services/publish/
// resources.ts):
//  (a) build-workspace.ts, with the publish plugins, compiled to one ESM file
//      in dist/publish-child/. Main runs it as Node in the workspace; it
//      loads the workspace's own Vite at run time. electron-builder.yml
//      unpacks it from the asar and ships the runtime source beside it.
//  (b) the viewer (vite.viewer.config.ts) in dist-viewer/, which every site
//      copies. Built fresh for `electron-vite build` (and so build:mac and
//      release); in dev only when it is missing, since `npm run build:viewer`
//      and `npm run dev:viewer` own it there.
const publishAssets = (): Plugin => {
  let watch = false;
  return {
    name: "antidraw:publish-assets",
    configResolved(config) {
      watch = !!config.build.watch;
    },
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        root: __dirname,
        build: {
          ssr: path.resolve(__dirname, "src/publish/build-workspace.ts"),
          outDir: path.resolve(__dirname, "dist/publish-child"),
          emptyOutDir: true,
          minify: false,
          sourcemap: false,
          target: "node22",
          rollupOptions: {
            output: {
              format: "es",
              entryFileNames: "build-workspace.mjs",
              inlineDynamicImports: true,
            },
          },
        },
      });
      if (!watch || !fs.existsSync(path.resolve(__dirname, "dist-viewer/index.html"))) {
        await build({
          configFile: path.resolve(__dirname, "vite.viewer.config.ts"),
          logLevel: "warn",
        });
      }
    },
  };
};

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
    plugins: [copyDrizzleMigrations(), publishAssets()],
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

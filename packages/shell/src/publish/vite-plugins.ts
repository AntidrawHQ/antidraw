// The Vite plugins a publish build adds on top of the workspace's own config
// (see build-workspace.ts). They ship with the app rather than with
// @antidrawapp/runtime, so changing how workspaces are published is an app
// update, not an `npm install` in every workspace.
//
// This file runs in a child Node process against the workspace's Vite: the
// app has no Vite of its own, so the functions needed from it are passed in,
// and only types are imported.

import fs from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig, normalizePath, transformWithEsbuild } from "vite";

export type ViteApi = {
  normalizePath: typeof normalizePath;
  transformWithEsbuild: typeof transformWithEsbuild;
};

const USER_COMPONENTS_DIR = "src/components/user-components";
const SCANNABLE_FILE_RE = /\.(m?[jt]s|[jt]sx)$/;
// The router module a workspace's main.tsx renders.
const RUNTIME_ROUTER = "@antidrawapp/runtime/router";

// Is this a workspace source file (not a dependency, not the runtime)?
const isWorkspaceSource = (vite: ViteApi, root: string, file: string) => {
  const normalized = vite.normalizePath(file);
  return (
    normalized.startsWith(vite.normalizePath(root) + "/") &&
    !normalized.includes("/node_modules/")
  );
};

// The preview page comes from the runtime source the app ships (runtimeSrc),
// not from the @antidrawapp/runtime the workspace installed: publishing then
// works the same for every workspace, whatever runtime version it is on. Its
// own imports (react, @tanstack/react-router) still resolve to the
// workspace's packages, through the runtime plugin's resolve.dedupe.
const runtimeFromApp = (runtimeSrc: string): Plugin => {
  let used = false;
  return {
    name: "antidraw-publish:runtime-from-app",
    enforce: "pre",
    resolveId(id) {
      // Workspaces from before the app skeleton moved into the template
      // import the runtime's root, which no longer has an entry.
      if (id === "@antidrawapp/runtime") {
        this.error(
          `src/main.tsx imports "@antidrawapp/runtime", from the old workspace template; it needs to render the router from "${RUNTIME_ROUTER}" (see the current template's main.tsx)`,
        );
      }
      if (id !== RUNTIME_ROUTER) return null;
      used = true;
      return path.join(runtimeSrc, "router.ts");
    },
    buildEnd(error) {
      if (!error && !used) {
        this.error(
          `the workspace never imports "${RUNTIME_ROUTER}" (see src/main.tsx), so it has no preview page to publish`,
        );
      }
    },
  };
};

// In dev, the runtime's load-component.ts imports a component by a path built
// at runtime, and the dev server transforms whatever is on disk. A build has
// no server behind it, so that import would 404 for every component. This
// replaces the module with a map from each component name to a lazy import of
// its file: Rollup then sees every component, and each one becomes its own
// chunk, loaded only when its frame is shown.
//
// The names Preview refuses are left out: they cannot be requested in dev
// either, and "?" or "#" in an import path would read as a query or a hash.
const UNUSABLE_NAME_RE = /[/\\?#\0]/;

const componentsForBuild = (vite: ViteApi, runtimeSrc: string): Plugin => {
  let config: ResolvedConfig;
  let loadComponentFile: string;

  return {
    name: "antidraw-publish:components-for-build",
    configResolved(resolved) {
      config = resolved;
      loadComponentFile = vite.normalizePath(
        fs.realpathSync(path.join(runtimeSrc, "load-component.ts")),
      );
    },
    load(id) {
      if (vite.normalizePath(id.split("?")[0]!) !== loadComponentFile) return null;

      const dir = path.join(config.root, USER_COMPONENTS_DIR);
      const dirents = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
      const entries: string[] = [];
      for (const dirent of dirents) {
        if (!dirent.isFile() || !dirent.name.endsWith(".tsx")) continue;
        const name = dirent.name.slice(0, -".tsx".length);
        if (!name || UNUSABLE_NAME_RE.test(name)) {
          config.logger.warn(
            `[antidraw] ${dirent.name} cannot be previewed (names cannot contain / \\ ? or #) — left out of the build`,
          );
          continue;
        }
        const file = JSON.stringify(vite.normalizePath(path.join(dir, dirent.name)));
        entries.push(`  ${JSON.stringify(name)}: () => import(${file}),`);
      }
      config.logger.info(`[antidraw] building ${entries.length} components`);

      return [
        "const components = {",
        ...entries,
        "}",
        "export const loadComponent = (name) =>",
        "  Object.hasOwn(components, name)",
        "    ? components[name]()",
        "    : Promise.reject(new Error(`Component \"${name}\" not found`))",
      ].join("\n");
    },
  };
};

// A build bundles every component, so one file that does not parse, or one
// import that does not resolve (a package that is not installed, a helper not
// written yet), would fail the whole build — where in dev it only breaks the
// previews that load it. Such a module is swapped for a stub that throws when
// it runs, with a warning naming it: the build finishes, and only the frames
// that import it fail to load. syntheticNamedExports lets any named import
// from the stub bind, so its importers still link. A named import the target
// module does not export (a package whose API changed) is the same story:
// shimMissingExports binds it to undefined with a warning instead of failing
// the build, matching dev, where only that preview fails.
const STUB_PREFIX = "\0antidraw-broken:";

const throwingModule = (reason: string) => ({
  code: `throw new Error(${JSON.stringify(reason)})\nexport default {}`,
  syntheticNamedExports: true,
});

const tolerateBrokenSource = (vite: ViteApi): Plugin => {
  let config: ResolvedConfig;
  const stubs = new Map<string, string>();

  return {
    name: "antidraw-publish:tolerate-broken-source",
    config: () => ({
      build: { rollupOptions: { shimMissingExports: true } },
    }),
    configResolved(resolved) {
      config = resolved;
    },
    // "post": reached only by imports every other resolver gave up on.
    resolveId: {
      order: "post",
      handler(id, importer) {
        if (!importer || !isWorkspaceSource(vite, config.root, importer)) return null;
        if (id.startsWith("\0")) return null;
        const reason = `"${id}" (imported by ${path.relative(config.root, importer)}) could not be resolved`;
        config.logger.warn(`[antidraw] ${reason} — replaced with a module that throws`);
        const stubId = `${STUB_PREFIX}${stubs.size}`;
        stubs.set(stubId, reason);
        return stubId;
      },
    },
    async load(id) {
      const reason = stubs.get(id);
      if (reason !== undefined) return throwingModule(reason);

      if (!SCANNABLE_FILE_RE.test(id) || !isWorkspaceSource(vite, config.root, id)) return null;
      const code = await fs.promises.readFile(id, "utf8");
      try {
        await vite.transformWithEsbuild(code, id);
        return code;
      } catch (e) {
        // esbuild's message is a count line followed by one
        // "file:line:col: ERROR: …" line per error; show the first.
        const lines = (e as Error).message.split("\n");
        const first = (lines[1]?.trim() || lines[0]!).replace(`${id}:`, "line ");
        const reason = `${path.relative(config.root, id)} could not be parsed: ${first}`;
        config.logger.warn(`[antidraw] ${reason} — replaced with a module that throws`);
        return throwingModule(reason);
      }
    },
  };
};

export const publishPlugins = (vite: ViteApi, runtimeSrc: string): Plugin[] => [
  runtimeFromApp(runtimeSrc),
  componentsForBuild(vite, runtimeSrc),
  tolerateBrokenSource(vite),
];

// The Vite plugins a publish build adds on top of the workspace's own config
// (see build-workspace.ts). They ship with the app rather than with
// @antidrawapp/runtime, so changing how workspaces are published is an app
// update, not an `npm install` in every workspace.
//
// This file runs in a child Node process against the workspace's Vite: the
// app has no Vite of its own, so the functions needed from it are passed in,
// and only types are imported.

import fs from "node:fs";
import os from "node:os";
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

// Build messages end up in the published bundle (as stub errors), so they
// name files relative to the workspace, and nothing by its path on this
// machine: the workspace root becomes ".", the home directory "~".
export const redactPaths = (vite: ViteApi, root: string, text: string) => {
  const replace = (from: string, to: string) => {
    for (const form of new Set([from, vite.normalizePath(from)])) text = text.split(form).join(to);
  };
  replace(root + path.sep, "");
  replace(root, ".");
  replace(os.homedir(), "~");
  return text;
};

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

const componentsForBuild = (
  vite: ViteApi,
  runtimeSrc: string,
  broken: BrokenFiles,
): Plugin => {
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
        if (!dirent.name.endsWith(".tsx")) continue;
        // Symlinks too, as the shell lists them.
        if (!fs.statSync(path.join(dir, dirent.name), { throwIfNoEntry: false })?.isFile()) continue;
        const name = dirent.name.slice(0, -".tsx".length);
        if (!name || UNUSABLE_NAME_RE.test(name)) {
          config.logger.warn(
            `[antidraw] ${dirent.name} cannot be previewed (names cannot contain / \\ ? or #) — left out of the build`,
          );
          continue;
        }
        const file = vite.normalizePath(path.join(dir, dirent.name));
        // A component a previous attempt failed on (see tolerateBrokenSource)
        // is not imported at all: this module is the app's, not the
        // workspace's, so its imports are never stubbed.
        const reason = broken.get(file);
        entries.push(
          reason === undefined
            ? `  [${JSON.stringify(name)}]: () => import(${JSON.stringify(file)}),`
            : `  [${JSON.stringify(name)}]: () => Promise.reject(new Error(${JSON.stringify(reason)})),`,
        );
      }
      config.logger.info(`[antidraw] building ${entries.length} components`);

      return [
        // Computed keys and no prototype, so a component named __proto__ is an
        // entry like any other.
        "const components = {",
        "  __proto__: null,",
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
// written yet, a subpath the package does not export), would fail the whole
// build — where in dev it only breaks the previews that load it. Such a module
// is swapped for a stub that throws when it runs, with a warning naming it:
// the build finishes, and only the frames that import it fail to load.
// syntheticNamedExports lets any named import from the stub bind, so its
// importers still link. A named import the target module does not export (a
// package whose API changed) is the same story: shimMissingExports binds it
// to undefined with a warning instead of failing the build, matching dev,
// where only that preview fails.
//
// What fails later than resolving and loading (a CSS file Tailwind cannot
// build, a web worker's own bundle) fails the build; build-workspace.ts then
// adds the failing file to `broken` and builds again, and imports of it get a
// stub like the rest. Not from the page's own entry (main.tsx), though: a stub
// there would fail every preview, so that build fails as it should.
const STUB_PREFIX = "\0antidraw-broken:";

const throwingModule = (reason: string) => ({
  code: `throw new Error(${JSON.stringify(reason)})\nexport default {}`,
  syntheticNamedExports: true,
});

// Files a previous attempt failed on, by normalized path, with the reason.
export type BrokenFiles = Map<string, string>;

// Every file the build emits gets a content hash in its name, whatever names
// the workspace's config asks for: site.ts uploads the build's files (Vite's
// manifest) to be cached for a year, which is only safe for hashed names.
const hashedOutputNames = (): Plugin => ({
  name: "antidraw-publish:hashed-output-names",
  outputOptions: (options) => ({
    ...options,
    entryFileNames: "assets/[name]-[hash].js",
    chunkFileNames: "assets/[name]-[hash].js",
    assetFileNames: "assets/[name]-[hash][extname]",
  }),
});

const tolerateBrokenSource = (vite: ViteApi, broken: BrokenFiles): Plugin => {
  let config: ResolvedConfig;
  const stubs = new Map<string, string>();
  // What index.html loads directly (main.tsx).
  const entryModules = new Set<string>();

  const redact = (text: string) => redactPaths(vite, config.root, text);

  const stub = (reason: string) => {
    reason = redact(reason);
    config.logger.warn(`[antidraw] ${reason} — replaced with a module that throws`);
    const stubId = `${STUB_PREFIX}${stubs.size}`;
    stubs.set(stubId, reason);
    return stubId;
  };

  const brokenJson = (file: string) => {
    try {
      // vite:json drops a byte order mark too.
      JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      return null;
    } catch (e) {
      return `${path.relative(config.root, file)} could not be parsed: ${(e as Error).message}`;
    }
  };

  return {
    name: "antidraw-publish:tolerate-broken-source",
    config: () => ({
      build: { rollupOptions: { shimMissingExports: true } },
    }),
    configResolved(resolved) {
      config = resolved;
    },
    // "pre", so that a resolver further down that throws (a package subpath
    // missing from its "exports") is caught here too, not only one that gives
    // up. The rest of the chain runs once, through this.resolve.
    resolveId: {
      order: "pre",
      async handler(id, importer, options) {
        if (!importer || !isWorkspaceSource(vite, config.root, importer)) return null;
        if (id.startsWith("\0")) return null;
        // runtimeFromApp stops the build on the old template's import, and
        // should not become a stub.
        if (id === "@antidrawapp/runtime") return null;
        // Other plugins probe with this.resolve and cope with a miss
        // themselves: import.meta.glob resolves its pattern ("@/assets/*")
        // through the alias. A stub would read as a match.
        if (options.custom?.["vite:import-glob"] || id.includes("*")) return null;
        // index.html's <link>s and <script>s: Vite leaves one it cannot
        // resolve in the page as it is, and a stub there would be bundled
        // into the entry chunk and fail every preview.
        if (importer.endsWith(".html")) {
          const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
          if (resolved) entryModules.add(vite.normalizePath(resolved.id.split("?")[0]!));
          return resolved;
        }

        const unresolved = `"${id}" (imported by ${path.relative(config.root, importer)}) could not be resolved`;
        let resolved;
        try {
          resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
        } catch (e) {
          return stub(`${unresolved}: ${(e as Error).message}`);
        }
        if (!resolved) return stub(unresolved);
        if (resolved.external) return resolved;

        const [file, query] = resolved.id.split("?") as [string, string | undefined];
        const normalized = vite.normalizePath(file);
        const reason = broken.get(normalized);
        if (reason !== undefined && !entryModules.has(vite.normalizePath(importer))) {
          return stub(reason);
        }
        // A JSON file that does not parse fails vite:json's transform, which
        // load (below) cannot catch: it has to be swapped before it loads.
        // With a query (?raw, ?url) it is not parsed at all.
        if (!query && file.endsWith(".json") && isWorkspaceSource(vite, config.root, file)) {
          const reason = brokenJson(file);
          if (reason) return stub(reason);
        }
        return resolved;
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
        const reason = redact(`${path.relative(config.root, id)} could not be parsed: ${first}`);
        config.logger.warn(`[antidraw] ${reason} — replaced with a module that throws`);
        return throwingModule(reason);
      }
    },
  };
};

export const publishPlugins = (
  vite: ViteApi,
  runtimeSrc: string,
  broken: BrokenFiles,
): Plugin[] => [
  runtimeFromApp(runtimeSrc),
  componentsForBuild(vite, runtimeSrc, broken),
  hashedOutputNames(),
  tolerateBrokenSource(vite, broken),
];

// The workspace file a failed build failed on, if the build could go on
// without it: a workspace source file (not a dependency, not the app's
// runtime) that is not already stubbed.
export const failedWorkspaceFile = (
  vite: ViteApi,
  root: string,
  error: unknown,
  broken: BrokenFiles,
) => {
  // Rollup names the module an error came from, except when loading it
  // failed (a web worker's own bundle), which only its message says.
  const { id: errorId, message } = error as { id?: unknown; message?: unknown };
  const id =
    typeof errorId === "string"
      ? errorId
      : typeof message === "string"
        ? /^(?:\[[^\]]+\] )?Could not load (.+?) \(imported by /.exec(message)?.[1]
        : undefined;
  if (!id || id.startsWith("\0")) return null;
  const file = vite.normalizePath(id.split("?")[0]!);
  if (!isWorkspaceSource(vite, root, file) || file.endsWith(".html") || broken.has(file)) return null;
  return file;
};

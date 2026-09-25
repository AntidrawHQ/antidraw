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
import type { Plugin, ResolvedConfig, normalizePath } from "vite";

export type ViteApi = {
  normalizePath: typeof normalizePath;
};

const USER_COMPONENTS_DIR = "src/components/user-components";
// The router module a workspace's main.tsx renders.
const RUNTIME_ROUTER = "@antidrawapp/runtime/router";

// Build messages end up in the published bundle (as stub errors), so they
// name files relative to the workspace, and nothing by its path on this
// machine: the workspace root becomes ".", the home directory "~".
export const redactPaths = (vite: ViteApi, root: string, text: string) => {
  // And no terminal colour codes, which Vite adds to its messages in a TTY.
  text = text.replace(ANSI_COLOR_RE, "");
  const replace = (from: string, to: string) => {
    for (const form of new Set([from, vite.normalizePath(from)])) text = text.split(form).join(to);
  };
  replace(root + path.sep, "");
  replace(root, ".");
  // Not a home directory of "/" (a service user's), which is every path.
  const home = os.homedir();
  if (home && home !== path.parse(home).root) replace(home, "~");
  return text;
};

const ANSI_COLOR_RE = /\x1b\[[0-9;]*m/g;

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
        // workspace's, so its imports are never stubbed. Failures are
        // recorded under the file's real path (a symlinked component's
        // target).
        const reason =
          broken.get(vite.normalizePath(fs.realpathSync(file))) ?? broken.get(file);
        if (reason !== undefined) {
          config.logger.warn(`[antidraw] ${reason} — the component is left out of the build`);
        }
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
// importers still link.
//
// What fails after resolving (a file that does not parse, a CSS file Tailwind
// cannot build, a web worker's own bundle, a named import the target module
// does not export, which in dev fails that module as a whole) fails the build;
// build-workspace.ts then adds the failing file to `broken` and builds again,
// and imports of it get a stub like the rest. A stub the page's own entry
// (main.tsx and what it imports) needs fails the build, though, since every
// preview would fail (see buildEnd).
const STUB_PREFIX = "\0antidraw-broken:";
// Marks the resolutions tolerateBrokenSource makes itself.
const INNER_RESOLVE = "antidraw-publish:inner-resolve";

const throwingModule = (reason: string) => ({
  code: `throw new Error(${JSON.stringify(reason)})\nexport default {}`,
  syntheticNamedExports: true,
});

// Files a previous attempt failed on, by normalized path, with the reason.
export type BrokenFiles = Map<string, string>;

// The build's output, whatever the workspace's config asks for: every file it
// emits gets a content hash in its name, since site.ts uploads the build's
// files to be cached for a year, which is only safe for hashed names; and no
// source maps, which would publish this machine's paths (see
// build-workspace.ts). Output options apply after the config's.
//
// The list of files the build emitted (web workers' bundles included, which
// Vite's manifest leaves out) goes to EMITTED_FILES, for site.ts to tell them
// from the public/ files copied next to them.
export const EMITTED_FILES = ".vite/antidraw-emitted.json";

const publishOutput = (vite: ViteApi, outDir: string): Plugin => ({
  name: "antidraw-publish:output",
  // Nor a directory of its own: output.dir or output.file in the config
  // would send the build (and Vite's emptying of it) elsewhere than outDir.
  // build-workspace.ts sets outDir for the build and for the client
  // environment; should any build still point elsewhere, it fails here,
  // before Vite empties anything.
  configResolved(config) {
    const builds = [config.build, ...Object.values(config.environments ?? {}).map((e) => e.build)];
    for (const build of builds) {
      // Settings a config can only add to through the inline config: Vite
      // joins arrays (an input list) and skips nulls when merging.
      build.rollupOptions.input = path.join(config.root, "index.html");
      build.watch = null;
      // Manifests are keyed by module id, local paths among them; one named
      // outside .vite/ (which site.ts deletes) would be published.
      build.manifest = false;
      build.ssrManifest = false;
      const output = build.rollupOptions.output;
      for (const options of Array.isArray(output) ? output : output ? [output] : []) {
        delete options.dir;
        delete options.file;
      }
    }
    const expected = vite.normalizePath(path.resolve(outDir));
    const client = config.environments?.client?.build ?? config.build;
    for (const build of [config.build, client]) {
      const actual = vite.normalizePath(path.resolve(config.root, build.outDir));
      if (actual !== expected) {
        throw new Error(`the workspace's Vite config builds into ${actual}, not the site's out dir`);
      }
    }
  },
  outputOptions: (options) => ({
    ...options,
    sourcemap: false,
    // Module-per-file output names chunks after their paths on this machine.
    preserveModules: false,
    entryFileNames: "assets/[name]-[hash].js",
    chunkFileNames: "assets/[name]-[hash].js",
    assetFileNames: "assets/[name]-[hash][extname]",
  }),
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      this.emitFile({
        type: "asset",
        fileName: EMITTED_FILES,
        source: JSON.stringify(Object.keys(bundle).sort()),
      });
    },
  },
});

const tolerateBrokenSource = (
  vite: ViteApi,
  broken: BrokenFiles,
): Plugin => {
  let config: ResolvedConfig;
  const stubs = new Map<string, string>();

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
    configResolved(resolved) {
      config = resolved;
    },
    // "pre", so that a resolver further down that throws (a package subpath
    // missing from its "exports") is caught here too, not only one that gives
    // up. The rest of the chain runs once, through this.resolve.
    resolveId: {
      order: "pre",
      async handler(id, importer, options) {
        // A probe made while one of this hook's own resolutions runs (the
        // alias; vite-tsconfig-paths trying each candidate path): the plugin
        // that made it copes with a miss, so it goes on untouched. Only the
        // outermost resolution of an import decides on a stub.
        if (options.custom?.[INNER_RESOLVE]) return null;
        if (!importer || !isWorkspaceSource(vite, config.root, importer)) return null;
        if (id.startsWith("\0")) return null;
        // runtimeFromApp stops the build on the old template's import, and
        // should not become a stub.
        if (id === "@antidrawapp/runtime") return null;
        // Other plugins probe with this.resolve and cope with a miss
        // themselves: import.meta.glob resolves its pattern ("@/assets/*")
        // through the alias. A stub would read as a match.
        if (options.custom?.["vite:import-glob"] || id.includes("*")) return null;
        const inner = {
          ...options,
          skipSelf: true,
          custom: { ...options.custom, [INNER_RESOLVE]: true },
        };

        // Vite leaves an index.html <link> it cannot resolve in the page as
        // it is.
        if (importer.endsWith(".html")) return this.resolve(id, importer, inner);

        const unresolved = `"${id}" (imported by ${path.relative(config.root, importer)}) could not be resolved`;
        let resolved;
        try {
          resolved = await this.resolve(id, importer, inner);
        } catch (e) {
          return stub(`${unresolved}: ${(e as Error).message}`);
        }
        // Vite's alias answers with its rewritten id, flagged, when nothing
        // resolved that ("@/lib/x" → "<root>/src/lib/x").
        const aliasMissed = (resolved?.meta?.["vite:alias"] as { noResolved?: boolean } | undefined)
          ?.noResolved;
        if (!resolved || aliasMissed) return stub(unresolved);
        if (resolved.external) return resolved;

        const [file, query] = resolved.id.split("?") as [string, string | undefined];
        const normalized = vite.normalizePath(file);
        const reason = broken.get(normalized);
        if (reason !== undefined) return stub(reason);
        if (!isWorkspaceSource(vite, config.root, file)) return resolved;
        // A JSON file that does not parse fails vite:json's transform, which
        // load (below) cannot catch: it has to be swapped before it loads.
        // With a query (?raw, ?url) it is not parsed at all.
        if (!query && file.endsWith(".json")) {
          const reason = brokenJson(file);
          if (reason) return stub(reason);
        }
        return resolved;
      },
    },
    load(id) {
      const reason = stubs.get(id);
      return reason === undefined ? null : throwingModule(reason);
    },
    // A stub the page's own entry imports (main.tsx, or anything it imports
    // statically, all the way down) would throw before the router renders,
    // and every preview would be blank behind a build that reports success.
    // That build fails instead, as plain Vite's would. The components are
    // imported dynamically (by the runtime's load-component), so a stub
    // only they reach is not the entry's. Checked once the whole graph is
    // known: which importer reaches a file first depends on timing.
    buildEnd(error) {
      if (error) return;
      const inEntry: string[] = [];
      for (const [stubId, reason] of stubs) {
        const seen = new Set<string>();
        const queue = [stubId];
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          if (seen.has(id)) continue;
          seen.add(id);
          const info = this.getModuleInfo(id);
          if (!info) continue;
          if (info.isEntry) {
            inEntry.push(reason);
            break;
          }
          queue.push(...info.importers);
        }
      }
      if (inEntry.length) {
        this.error(
          `the page's entry (src/main.tsx and what it imports) needs files that are broken, so no preview could load:\n  ${inEntry.join("\n  ")}`,
        );
      }
    },
  };
};

export const publishPlugins = (
  vite: ViteApi,
  runtimeSrc: string,
  outDir: string,
  broken: BrokenFiles,
): Plugin[] => {
  return [
    runtimeFromApp(runtimeSrc),
    componentsForBuild(vite, runtimeSrc, broken),
    publishOutput(vite, outDir),
    tolerateBrokenSource(vite, broken),
  ];
};

// The workspace file a failed build failed on, if the build could go on
// without it: a workspace source file (not a dependency, not the app's
// runtime) that is not already stubbed.
export const failedWorkspaceFile = (
  vite: ViteApi,
  root: string,
  error: unknown,
  broken: BrokenFiles,
) => {
  // Rollup names the module an error came from. A web worker imported with
  // ?worker whose own bundle failed is the exception: the error's id is then
  // a file inside that bundle, which this build's plugins never see, and the
  // worker to stub is the one the message says could not be loaded. (A
  // worker made with new Worker(new URL(…)) fails in the transform of the
  // file that makes it, which the id names.) Vite colours the message in a
  // terminal.
  const { id: errorId, message } = error as { id?: unknown; message?: unknown };
  const text = typeof message === "string" ? message.replace(ANSI_COLOR_RE, "") : "";
  const couldNotLoad = /^(?:\[[^\]]+\] )?Could not load (.+?) \(imported by /.exec(text)?.[1];
  // Vite's own test for a worker import: ?worker or ?sharedworker.
  const candidates = couldNotLoad && /[?&](?:shared)?worker(?:&|$)/.test(couldNotLoad)
    ? [couldNotLoad, errorId]
    : [errorId, couldNotLoad];
  // A symlinked component's target may lie outside the workspace; it is
  // still the workspace's, and componentsForBuild leaves it out by that path.
  const componentTargets = new Set(
    (fs.existsSync(path.join(root, USER_COMPONENTS_DIR))
      ? fs.readdirSync(path.join(root, USER_COMPONENTS_DIR))
      : []
    ).flatMap((name) => {
      try {
        return [vite.normalizePath(fs.realpathSync(path.join(root, USER_COMPONENTS_DIR, name)))];
      } catch {
        return [];
      }
    }),
  );
  for (const id of candidates) {
    if (typeof id !== "string" || id.startsWith("\0")) continue;
    const file = vite.normalizePath(id.split("?")[0]!);
    const ours = isWorkspaceSource(vite, root, file) || componentTargets.has(file);
    if (!ours || file.endsWith(".html") || broken.has(file)) continue;
    return file;
  }
  return null;
};

// Turning a workspace build into a site, and listing a site's files for
// upload: shared by the app's Publish (src/main/services/publish) and
// scripts/site.ts.
//
// A site is one self-contained static directory, served from the root of its
// own origin:
//
//   index.html, _antidraw/   the viewer (src/viewer): the canvas, read-only
//   canvas.json              the components and where their frames sit
//   preview.html             the workspace build's index.html, which the
//                            origin serves at /preview (the runtime's route)
//   assets/, public files    the rest of the workspace build
//
// Node-only, and type-strip-safe, since scripts/site.ts runs it under plain
// `node`: relative .ts imports, `import type` for types, no enums, no
// parameter properties, no @ alias.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import type { CanvasFile } from "../viewer/canvas-file.ts";
import { contentType } from "./content-types.ts";

// The pages and the canvas: every built site has all three. They are
// ordinary site files (stored by content like the rest; a site switches to a
// new version in one pointer write), listed apart only so a publish can check
// they are there.
export const SITE_ENTRY_FILES = ["preview.html", "canvas.json", "index.html"] as const;
// The workspace build's content-hashed files (see SiteFile.immutable). Only
// listSiteFiles reads it; it is not a file of the site.
export const HASHED_FILES = ".hashed-files.json";
// Where the publish plugins list the files the build emitted (EMITTED_FILES
// in vite-plugins.ts).
export const BUILD_EMITTED = ".vite/antidraw-emitted.json";
// What the publish plugins name emitted files: Rollup's [hash] is 8 characters.
// (A manualChunks name can put a chunk in a folder under assets/.) The name
// alone does not make a file immutable: the plan's `immutable` (from
// HASHED_FILES) does, and the publish Worker caches only files the pointer
// marks so ("i") for a year (cacheControlFor in
// packages/publish-worker/src/serve.ts).
export const HASHED_NAME_RE = /^assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
// The viewer's build output, all content-hashed (it has no public/ files).
export const VIEWER_ASSETS_DIR = "_antidraw/";
export const USER_COMPONENTS_DIR = "src/components/user-components";
// Same rule as the runtime plugin: names Preview cannot load.
export const UNUSABLE_NAME_RE = /[/\\?#\0]/;

// A site built before: a canvas.json alone could be anyone's.
export const isBuiltSite = (dir: string): boolean =>
  fs.existsSync(path.join(dir, "canvas.json")) && fs.existsSync(path.join(dir, HASHED_FILES));

// Emptied the way Vite empties an out dir, keeping a .git.
export const emptyOutDir = (dir: string): void => {
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (name !== ".git") fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
};

// The build empties outDir first, so it must be a site built before, or new,
// and hold neither the app nor the workspace. The error's text, or null.
export const checkOutDir = (
  outDir: string,
  guard: { appDir?: string; sourceDir: string },
): string | null => {
  const contains = (dir: string, inner: string) =>
    inner === dir || inner.startsWith(dir + path.sep);
  const held = [guard.appDir, guard.sourceDir].filter((dir): dir is string => !!dir);
  if (held.some((dir) => contains(path.resolve(outDir), path.resolve(dir)))) {
    return `${outDir} holds the app or the workspace; pick another --out`;
  }
  if (
    fs.existsSync(outDir) &&
    fs.readdirSync(outDir).some((name) => name !== ".git") &&
    !isBuiltSite(outDir)
  ) {
    return `${outDir} is not empty and is not a built site, and the build would empty it; pick another --out`;
  }
  return null;
};

// The components the canvas shows, as the publish build bundles them
// (componentsForBuild in vite-plugins.ts): .tsx files in the user components
// directory that are files, symlinks to files included, without the names
// Preview cannot load. Sorted by name, whatever order the directory lists
// them in.
export const readCanvasComponents = (sourceDir: string): { name: string }[] => {
  const dir = path.join(sourceDir, USER_COMPONENTS_DIR);
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.isFile())
    .map((f) => f.slice(0, -".tsx".length))
    .filter((name) => name && !UNUSABLE_NAME_RE.test(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name }));
};

// Only the frames of components the site has: the frame_layouts table keeps
// rows for deleted and renamed ones, whose names are not the site's to
// publish.
export const makeCanvasFile = (
  name: string,
  components: { name: string }[],
  layouts: { componentName: string; x: number; y: number; width: number; height: number }[],
): CanvasFile => {
  const names = new Set(components.map((c) => c.name));
  return {
    version: 1,
    name,
    components,
    layouts: layouts
      .filter((l) => names.has(l.componentName))
      .map(({ componentName, x, y, width, height }) => ({ componentName, x, y, width, height })),
  };
};

export type SiteAssemblyError = { code: "SITE_ASSEMBLY_FAILED"; message: string };

// Turns a workspace build in outDir into a site: its index.html becomes
// preview.html, the viewer goes next to it, and canvas.json with it. Should
// any of it fail, outDir is emptied rather than left half-built (which the
// next site.ts build would refuse as not a site).
export const assembleSite = (opts: {
  outDir: string;
  viewerDir: string;
  canvas: CanvasFile;
}): Result<{ hashed: string[] }, SiteAssemblyError> => {
  const { outDir, viewerDir, canvas } = opts;
  const fail = (message: string) => {
    emptyOutDir(outDir);
    return err({ code: "SITE_ASSEMBLY_FAILED" as const, message });
  };

  try {
    // Everything the viewer adds must be free in the workspace build.
    for (const name of ["preview.html", "canvas.json", HASHED_FILES, ...fs.readdirSync(viewerDir)]) {
      if (name === "index.html") continue;
      if (fs.existsSync(path.join(outDir, name))) {
        return fail(`the workspace build has its own ${name} (from public/?), which the site needs`);
      }
    }
    if (!fs.existsSync(path.join(outDir, "index.html"))) {
      return fail("the workspace build wrote no index.html");
    }
    fs.renameSync(path.join(outDir, "index.html"), path.join(outDir, "preview.html"));
    // The files the build emitted are content-hashed; the rest are public/
    // files, which a republish may change (see listSiteFiles). The publish
    // plugins name every emitted file assets/[name]-[hash]; one a plugin
    // emits under a fixed name of its own (robots.txt) is not hashed.
    const emitted = JSON.parse(fs.readFileSync(path.join(outDir, BUILD_EMITTED), "utf8")) as unknown;
    if (!Array.isArray(emitted) || emitted.some((f) => typeof f !== "string")) {
      return fail(`${BUILD_EMITTED} is not a list of files`);
    }
    const hashed = [...new Set((emitted as string[]).filter((f) => HASHED_NAME_RE.test(f)))].sort();
    fs.rmSync(path.join(outDir, ".vite"), { recursive: true, force: true });
    fs.writeFileSync(path.join(outDir, HASHED_FILES), JSON.stringify(hashed, null, 2));
    fs.cpSync(viewerDir, outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "canvas.json"), JSON.stringify(canvas, null, 2));
    return ok({ hashed });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
};

export type SiteFile = {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
  // Named by its content: the viewer's assets and the build's hashed files,
  // which the Worker caches for a year and a republish keeps serving for tabs
  // still open on an older version. Public files, which a republish may
  // change, are not.
  immutable: boolean;
};

// Every regular file under root, as relative POSIX paths. Symlinks are not
// followed or listed.
export const listFiles = (root: string): string[] =>
  (fs.readdirSync(root, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join("/"));

const sha256File = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

// A built site's files, as a publish declares them: `entries` are
// SITE_ENTRY_FILES (all three, in that order), `files` everything else,
// `skipped` the hidden files left out. Sorted by path. Both lists are served
// alike; together they are the site.
//
// Dotfiles are not the site's (a Finder .DS_Store, a stray .env in public/),
// except .well-known/ itself, which is there to be served, and what the build
// emitted (a component named .Dot.tsx).
export const listSiteFiles = async (
  dir: string,
): Promise<{ files: SiteFile[]; entries: SiteFile[]; skipped: string[] }> => {
  const root = path.resolve(dir);
  const hashedFile = path.join(root, HASHED_FILES);
  const hashed = new Set<string>(
    fs.existsSync(hashedFile) ? JSON.parse(fs.readFileSync(hashedFile, "utf8")) : [],
  );
  const hidden = (f: string) =>
    !hashed.has(f) &&
    f
      .split("/")
      .slice(f.startsWith(".well-known/") ? 1 : 0)
      .some((part) => part.startsWith("."));
  const byPath = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  const listed = listFiles(root)
    .filter((f) => f !== HASHED_FILES)
    .sort(byPath);
  const skipped = listed.filter(hidden);

  const describe = async (f: string): Promise<SiteFile> => {
    const file = path.join(root, f);
    return {
      path: f,
      size: fs.statSync(file).size,
      sha256: await sha256File(file),
      contentType: contentType(f),
      immutable: f.startsWith(VIEWER_ASSETS_DIR) || hashed.has(f),
    };
  };
  const entryNames = new Set<string>(SITE_ENTRY_FILES);
  const missing = SITE_ENTRY_FILES.filter((f) => !listed.includes(f));
  if (missing.length) throw new Error(`${root} has no ${missing.join(", ")}: it is not a built site`);

  const files: SiteFile[] = [];
  for (const f of listed) {
    if (!hidden(f) && !entryNames.has(f)) files.push(await describe(f));
  }
  const entries: SiteFile[] = [];
  for (const f of SITE_ENTRY_FILES) entries.push({ ...(await describe(f)), immutable: false });
  return { files, entries, skipped };
};

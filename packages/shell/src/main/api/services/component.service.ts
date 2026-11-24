import path from "node:path";
import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import { ok, err } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { track } from "@/main/lib/posthog";

const USER_COMPONENTS_DIR = "src/components/user-components";

export type ComponentListItem = {
  name: string;
};

export type ComponentSource = {
  name: string;
  fileName: string;
  filePath: string;
  source: string;
};

// `changed`: a component came or went. `edited`: a file under src changed
// (a component, one of its parts, a style or helper), which the frames show
// by HMR, without a load.
export type ComponentStreamEvent = { type: "changed" } | { type: "edited" };

type ComponentEvents = {
  changed: [workspaceId: string];
  edited: [workspaceId: string];
};

class ComponentEventEmitter extends EventEmitter<ComponentEvents> {}

export const componentEvents = new ComponentEventEmitter();

const componentWatchers = new Map<string, FSWatcher>();

const getComponentsDir = (workspaceId: string) =>
  path.join(getWorkspaceSourcePath(workspaceId), USER_COMPONENTS_DIR);

export const listComponents = async (workspaceId: string) => {
  try {
    const dir = getComponentsDir(workspaceId);
    const files = await fs.readdir(dir).catch(() => [] as string[]);

    const components: ComponentListItem[] = files
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => ({ name: f.replace(".tsx", "") }));

    return ok(components);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "FS_ERROR",
      message: "Failed to list components",
    });
  }
};

export const getComponentSource = async (
  workspaceId: string,
  name: string,
) => {
  try {
    const dir = getComponentsDir(workspaceId);
    const filePath = path.resolve(dir, `${name}.tsx`);
    // The route validates the name, but this is the read: never leave the
    // components directory whatever the caller passed.
    if (path.dirname(filePath) !== dir) {
      return err({
        status: 404 as const,
        code: "NOT_FOUND",
        message: "Component not found",
      });
    }
    const source = await fs.readFile(filePath, "utf-8");

    return ok({
      name,
      fileName: `${name}.tsx`,
      filePath,
      source,
    } satisfies ComponentSource);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return err({
        status: 404 as const,
        code: "NOT_FOUND",
        message: "Component not found",
      });
    }

    return err({
      status: 500 as const,
      code: "FS_ERROR",
      message: "Failed to read component source",
    });
  }
};

// A component's file, or null for a name that would leave the components
// directory (the routes validate names; this holds whatever the caller passed).
const componentPath = (workspaceId: string, name: string) => {
  const dir = getComponentsDir(workspaceId);
  const filePath = path.resolve(dir, `${name}.tsx`);
  return path.dirname(filePath) === dir ? filePath : null;
};

export type NewComponent = { name: string; source: string };

// New frames, from the canvas (a paste, a duplicate, an undone delete): all of
// them or none. A name already taken is refused, never overwritten. The
// watcher puts them on the canvas as for any other new file.
export const createComponents = async (workspaceId: string, components: NewComponent[]) => {
  // macOS's file system ignores case: Card and card are one file.
  const names = components.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    return err({ status: 400 as const, code: "DUPLICATE_NAME", message: "Two of the new components have the same name" });
  }
  const paths = components.map((c) => componentPath(workspaceId, c.name));
  if (paths.some((p) => p === null)) {
    return err({ status: 400 as const, code: "INVALID_NAME", message: "Invalid component name" });
  }

  try {
    await fs.mkdir(getComponentsDir(workspaceId), { recursive: true });
    const existing = new Set(
      (await fs.readdir(getComponentsDir(workspaceId))).map((f) => f.toLowerCase()),
    );
    const taken = components.find((c) => existing.has(`${c.name}.tsx`.toLowerCase()));
    if (taken) {
      return err({ status: 409 as const, code: "EXISTS", message: `${taken.name} is already on the canvas` });
    }

    const written: string[] = [];
    try {
      for (const [i, component] of components.entries()) {
        // wx: a file that appeared since the check above is still never replaced.
        await fs.writeFile(paths[i]!, component.source, { encoding: "utf-8", flag: "wx" });
        written.push(paths[i]!);
      }
    } catch (e) {
      await Promise.all(written.map((p) => fs.rm(p, { force: true })));
      throw e;
    }
    return ok(components.map((c) => c.name));
  } catch (e: any) {
    if (e?.code === "EEXIST") {
      return err({ status: 409 as const, code: "EXISTS", message: "A component with that name is already on the canvas" });
    }
    return err({ status: 500 as const, code: "FS_ERROR", message: "Failed to create components" });
  }
};

// The OS trash, so a frame deleted on the canvas can still be had back after
// the app's own undo is gone (a restart). Electron's, loaded only when used.
let trashItem = async (filePath: string) => {
  const { shell } = await import("electron");
  await shell.trashItem(filePath);
};
export const setTrashItemForTests = (fn: typeof trashItem) => {
  trashItem = fn;
};

export type DeletedComponent = { name: string; source: string };

// Frames deleted from the canvas: each file read (for the canvas's undo) and
// moved to the trash. `expected` is each one's source as the canvas last
// wrote or read it: one that differs (the agent edited it since) is refused,
// and nothing is deleted. A file the trash refuses is left, and listed in
// `failed`; the rest are still deleted.
export const deleteComponents = async (
  workspaceId: string,
  names: string[],
  expected?: Record<string, string>,
) => {
  const paths = names.map((name) => componentPath(workspaceId, name));
  if (paths.some((p) => p === null)) {
    return err({ status: 400 as const, code: "INVALID_NAME", message: "Invalid component name" });
  }

  const sources: string[] = [];
  for (const [i, name] of names.entries()) {
    try {
      sources.push(await fs.readFile(paths[i]!, "utf-8"));
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        return err({ status: 404 as const, code: "NOT_FOUND", message: `${name} isn't on the canvas` });
      }
      return err({ status: 500 as const, code: "FS_ERROR", message: "Failed to read components" });
    }
    const want = expected?.[name];
    if (want !== undefined && want !== sources[i]) {
      return err({ status: 409 as const, code: "CHANGED", message: `${name} has changed since` });
    }
  }

  const deleted: DeletedComponent[] = [];
  const failed: string[] = [];
  for (const [i, name] of names.entries()) {
    try {
      await trashItem(paths[i]!);
      deleted.push({ name, source: sources[i]! });
    } catch (e) {
      console.error(`[deleteComponents] couldn't trash ${name}`, e);
      failed.push(name);
    }
  }
  return ok({ deleted, failed });
};

export const startComponentWatcher = async (workspaceId: string) => {
  if (componentWatchers.has(workspaceId)) {
    return;
  }

  const dir = getComponentsDir(workspaceId);

  // All of src, for edits: the components import from it all.
  const watcher = chokidar.watch(path.join(getWorkspaceSourcePath(workspaceId), "src"), {
    ignoreInitial: true,
    // Dotfiles, and editors' swap and backup files.
    ignored: (filePath) => /^\.|~$|\.(swp|tmp)$/.test(path.basename(filePath)),
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  // A component is a .tsx directly in user-components.
  const isComponent = (filePath: string) =>
    path.dirname(filePath) === dir && filePath.endsWith(".tsx");

  const onAddOrUnlink = (filePath: string) => {
    componentEvents.emit(isComponent(filePath) ? "changed" : "edited", workspaceId);
  };

  // A frame that came or went, with how many the canvas has now.
  const trackFrame = (event: "frame_created" | "frame_deleted") =>
    void listComponents(workspaceId).then((frames) =>
      track(event, { workspace_id: workspaceId, frame_count: frames.isOk() ? frames.value.length : null }),
    );

  watcher.on("add", (filePath) => {
    onAddOrUnlink(filePath);
    if (isComponent(filePath)) trackFrame("frame_created");
  });
  watcher.on("unlink", (filePath) => {
    onAddOrUnlink(filePath);
    if (isComponent(filePath)) trackFrame("frame_deleted");
  });
  watcher.on("change", () => componentEvents.emit("edited", workspaceId));
  watcher.on("error", (error) => {
    console.error(`[component-watcher:${workspaceId}]`, error);
  });

  componentWatchers.set(workspaceId, watcher);
};

export const stopComponentWatcher = async (workspaceId: string) => {
  const watcher = componentWatchers.get(workspaceId);
  if (!watcher) return;

  componentWatchers.delete(workspaceId);
  await watcher.close();
};

import path from "node:path";
import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import { ok, err } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";

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

  watcher.on("add", onAddOrUnlink);
  watcher.on("unlink", onAddOrUnlink);
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

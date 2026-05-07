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

export type ComponentStreamEvent = { type: "changed" };

type ComponentEvents = {
  changed: [workspaceId: string];
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

  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  const onChange = (filePath: string) => {
    if (!filePath.endsWith(".tsx")) return;
    componentEvents.emit("changed", workspaceId);
  };

  watcher.on("add", onChange);
  watcher.on("unlink", onChange);
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

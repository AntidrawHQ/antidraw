import path from "node:path";
import fs from "node:fs/promises";
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

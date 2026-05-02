import { workspaces } from "@/main/api/models/workspace.model";
import { db } from "@/main/db";
import { eq } from "drizzle-orm";
import { ok, err } from "neverthrow";
import fs from "node:fs/promises";
import {
  getWorkspacePath,
  getWorkspaceSourcePath,
  getWorkspacesPath,
} from "@/main/api/init";
import {
  npmCreate,
  npmInstall,
  type NpmOutput,
} from "@/main/lib/package-manager";
import { ensureRuntimeSymlink } from "@/main/lib/runtime-symlink";

// Status constants for createWorkspace - UI layer maps these to user-facing messages
export const CreateWorkspaceStatus = {
  CREATING_DIRECTORY: "CREATING_DIRECTORY",
  SCAFFOLDING_PROJECT: "SCAFFOLDING_PROJECT",
  INSTALLING_DEPENDENCIES: "INSTALLING_DEPENDENCIES",
  SAVING_WORKSPACE: "SAVING_WORKSPACE",
} as const;

export type CreateWorkspaceStatusCode =
  (typeof CreateWorkspaceStatus)[keyof typeof CreateWorkspaceStatus];

// Error codes for createWorkspace
export const CreateWorkspaceErrorCode = {
  NPM_CREATE_FAILED: "NPM_CREATE_FAILED",
  NPM_INSTALL_FAILED: "NPM_INSTALL_FAILED",
  WORKSPACE_CREATE_FAILED: "WORKSPACE_CREATE_FAILED",
} as const;

export type CreateWorkspaceErrorCodeType =
  (typeof CreateWorkspaceErrorCode)[keyof typeof CreateWorkspaceErrorCode];

// Yield types for createWorkspace generator
export type CreateWorkspaceEvent =
  | { type: "status"; status: CreateWorkspaceStatusCode }
  | { type: "npm"; output: NpmOutput }
  | { type: "done"; workspace: typeof workspaces.$inferSelect }
  | { type: "error"; error: { code: CreateWorkspaceErrorCodeType; message: string } };

export const createWorkspace = async function* (
  name: string
): AsyncGenerator<CreateWorkspaceEvent> {
  const id = crypto.randomUUID();
  const workspacePath = getWorkspacePath(id);
  const sourcePath = getWorkspaceSourcePath(id);

  try {
    // 1. Create workspace directories
    yield { type: "status", status: CreateWorkspaceStatus.CREATING_DIRECTORY };
    await fs.mkdir(getWorkspacesPath(), { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });

    // 2. Scaffold project with npm create
    yield { type: "status", status: CreateWorkspaceStatus.SCAFFOLDING_PROJECT };

    for await (const output of npmCreate(
      "@antidrawapp/workspace",
      "source",
      workspacePath
    )) {
      yield { type: "npm", output };

      if (output.type === "exit" && output.code !== 0) {
        await fs.rm(workspacePath, { recursive: true, force: true });

        yield {
          type: "error",
          error: {
            code: CreateWorkspaceErrorCode.NPM_CREATE_FAILED,
            message: "Failed to scaffold project",
          },
        };

        return;
      }
    }

    // 3. Symlink the runtime into <workspace>/source/.antidraw/runtime so
    //    npm install can resolve the file: dep declared in package.json.
    //    Must happen before npm install — npm errors out on a missing
    //    file: target.
    await ensureRuntimeSymlink(id);

    // 4. Install dependencies
    yield { type: "status", status: CreateWorkspaceStatus.INSTALLING_DEPENDENCIES };

    for await (const output of npmInstall(sourcePath)) {
      yield { type: "npm", output };

      if (output.type === "exit" && output.code !== 0) {
        await fs.rm(workspacePath, { recursive: true, force: true });

        yield {
          type: "error",
          error: {
            code: CreateWorkspaceErrorCode.NPM_INSTALL_FAILED,
            message: "Failed to install dependencies",
          },
        };
        return;
      }
    }

    // 5. Create database record

    const [workspace] = await db
      .insert(workspaces)
      .values({ id, name })
      .returning();

    yield { type: "done", workspace };
  } catch (e) {
    await fs.rm(workspacePath, { recursive: true, force: true });

    yield {
      type: "error",
      error: {
        code: CreateWorkspaceErrorCode.WORKSPACE_CREATE_FAILED,
        message: e instanceof Error ? e.message : "Unknown error",
      },
    };
  }
};

export const listWorkspaces = async () => {
  try {
    const result = await db.query.workspaces.findMany({
      orderBy: (workspaces, { desc }) => desc(workspaces.createdAt),
    });

    return ok(result);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to list workspaces",
    });
  }
};

export const getWorkspace = async (id: string) => {
  try {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, id),
    });

    if (!workspace) {
      return err({
        status: 404 as const,
        code: "NOT_FOUND",
        message: "Workspace not found",
      });
    }

    return ok(workspace);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to get workspace",
    });
  }
};

export const deleteWorkspace = async (id: string) => {
  try {
    // Check if workspace exists
    const existing = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, id),
    });

    if (!existing) {
      return err({
        status: 404 as const,
        code: "NOT_FOUND",
        message: "Workspace not found",
      });
    }

    // Delete from database (cascade will delete conversations/messages)
    await db.delete(workspaces).where(eq(workspaces.id, id));

    // Delete filesystem (force: true means no error if path doesn't exist)
    const workspacePath = getWorkspacePath(id);
    await fs.rm(workspacePath, { recursive: true, force: true });

    return ok({ deleted: true });
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "DB_ERROR",
      message: "Failed to delete workspace",
    });
  }
};

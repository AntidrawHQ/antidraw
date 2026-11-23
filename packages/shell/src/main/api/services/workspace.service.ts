import { workspaces } from "@/main/api/models/workspace.model";
import { conversations, messages } from "@/main/api/models/chat.model";
import { db } from "@/main/db";
import { eq, sql } from "drizzle-orm";
import { ok, err } from "neverthrow";
import fs from "node:fs/promises";
import {
  getWorkspacePath,
  getWorkspaceSourcePath,
  getWorkspacesPath,
} from "@/main/api/init";
import { getThumbnailVersion } from "@/main/services/thumbnail.service";
import {
  npmCreate,
  npmInstall,
  type NpmOutput,
} from "@/main/lib/package-manager";

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
            message: "Couldn't scaffold the project. Please try again.",
          },
        };

        return;
      }
    }

    // 3. Install dependencies
    yield { type: "status", status: CreateWorkspaceStatus.INSTALLING_DEPENDENCIES };

    for await (const output of npmInstall(sourcePath)) {
      yield { type: "npm", output };

      if (output.type === "exit" && output.code !== 0) {
        await fs.rm(workspacePath, { recursive: true, force: true });

        yield {
          type: "error",
          error: {
            code: CreateWorkspaceErrorCode.NPM_INSTALL_FAILED,
            message: "Couldn't install dependencies. Please try again.",
          },
        };
        return;
      }
    }

    // 4. Create database record
    yield { type: "status", status: CreateWorkspaceStatus.SAVING_WORKSPACE };

    const [workspace] = await db
      .insert(workspaces)
      .values({ id, name })
      .returning();

    yield { type: "done", workspace: workspace! };
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

// A workspace as the dashboard lists it: with its thumbnail's version (null:
// none yet) and when it was last worked in.
export type WorkspaceWithThumbnail = typeof workspaces.$inferSelect & {
  thumbnailVersion: number | null;
  lastActiveAt: number;
};

// When each workspace was last worked in: its newest message, in any of its
// conversations. Not workspaces.updated_at, which nothing moves. A workspace
// without a message isn't in the map: it was last active when it was made.
//
// Each conversation's newest message is its highest seq, found in the
// (conversation_id, seq) index, so one message is read per conversation.
// max(created_at) over them all reads every message, its transcript JSON
// included: most of a second on a database of 400,000, each time the list
// is asked for.
const lastActive = async (workspaceId?: string) => {
  const rows = await db
    .select({
      workspaceId: conversations.workspaceId,
      at: sql<number>`max(${messages.createdAt})`,
    })
    .from(conversations)
    .innerJoin(
      messages,
      sql`${messages.seq} = (select max(newest.seq) from messages as newest where newest.conversation_id = ${conversations.id})`,
    )
    .where(workspaceId ? eq(conversations.workspaceId, workspaceId) : undefined)
    .groupBy(conversations.workspaceId);
  return new Map(rows.map((row) => [row.workspaceId, row.at]));
};

const withThumbnail = async (
  workspace: typeof workspaces.$inferSelect,
  active: Map<string, number>,
): Promise<WorkspaceWithThumbnail> => ({
  ...workspace,
  thumbnailVersion: await getThumbnailVersion(workspace.id),
  lastActiveAt: active.get(workspace.id) ?? workspace.createdAt.getTime(),
});

export const listWorkspaces = async () => {
  try {
    const [result, active] = await Promise.all([
      db.query.workspaces.findMany({
        orderBy: (workspaces, { desc }) => desc(workspaces.createdAt),
      }),
      lastActive(),
    ]);

    return ok(await Promise.all(result.map((workspace) => withThumbnail(workspace, active))));
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

    return ok(await withThumbnail(workspace, await lastActive(id)));
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

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  type CreateWorkspaceEvent,
} from "../services/workspace.service";
import {
  startDevServer,
  stopDevServer,
  getDevServerStatus,
} from "@/main/services/dev-server.service";
import { listConversations } from "../services/chat.service";

export const workspaceController = new Hono();

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
});

const workspaceIdParamSchema = z.object({
  workspaceId: z.uuid(),
});

export type { CreateWorkspaceEvent as CreateWorkspaceResponse };

workspaceController.post(
  "/",
  zValidator("json", createWorkspaceSchema),
  async (ctx) => {
    const { name } = ctx.req.valid("json");

    return streamSSE(ctx, async (stream) => {
      for await (const event of createWorkspace(name)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    });
  }
);

workspaceController.get("/", async (ctx) => {
  const result = await listWorkspaces();

  if (result.isErr()) {
    const { status, code, message } = result.error;
    return ctx.json({ error: { code, message } }, status);
  }

  return ctx.json(result.value);
});

workspaceController.get(
  "/:workspaceId",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await getWorkspace(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

workspaceController.delete(
  "/:workspaceId",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await deleteWorkspace(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

// Conversation endpoints

workspaceController.get(
  "/:workspaceId/conversations",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await listConversations(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

// Dev Server endpoints

workspaceController.post(
  "/:workspaceId/dev-server",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await startDevServer(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

workspaceController.delete(
  "/:workspaceId/dev-server",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = stopDevServer(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

workspaceController.get(
  "/:workspaceId/dev-server",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = getDevServerStatus(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

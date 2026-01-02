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

export const workspaceController = new Hono();

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
});

export type { CreateWorkspaceEvent as CreateWorkspaceResponse };

workspaceController.post(
  "/",
  zValidator("json", createWorkspaceSchema),
  async (ctx) => {
    const { name } = ctx.req.valid("json");

    return streamSSE(ctx, async (stream) => {
      for await (const event of createWorkspace(name)) {
        stream.writeSSE({
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
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  async (ctx) => {
    const { id } = ctx.req.valid("param");
    const result = await getWorkspace(id);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

workspaceController.delete(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  async (ctx) => {
    const { id } = ctx.req.valid("param");
    const result = await deleteWorkspace(id);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

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
import {
  getFrameLayouts,
  saveFrameLayouts,
} from "../services/frame-layout.service";
import {
  listComponents,
  getComponentSource,
  componentEvents,
  type ComponentStreamEvent,
} from "../services/component.service";

export const workspaceController = new Hono();

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
});

const workspaceIdParamSchema = z.object({
  workspaceId: z.uuid(),
});

const componentNameParamSchema = z.object({
  workspaceId: z.uuid(),
  componentName: z.string().regex(/^[a-zA-Z0-9_-]+$/),
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

// Frame Layout endpoints

const frameLayoutSchema = z.object({
  layouts: z.array(
    z.object({
      componentName: z.string().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
});

workspaceController.get(
  "/:workspaceId/frame-layouts",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await getFrameLayouts(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  },
);

workspaceController.put(
  "/:workspaceId/frame-layouts",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", frameLayoutSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const { layouts } = ctx.req.valid("json");
    const result = await saveFrameLayouts(workspaceId, layouts);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ ok: true });
  },
);

// Component endpoints

workspaceController.get(
  "/:workspaceId/components",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const result = await listComponents(workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

workspaceController.get(
  "/:workspaceId/components/stream",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");

    return streamSSE(ctx, async (stream) => {
      const onChanged = (changedWorkspaceId: string) => {
        if (changedWorkspaceId !== workspaceId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "changed" } satisfies ComponentStreamEvent),
        });
      };

      componentEvents.on("changed", onChanged);

      ctx.req.raw.signal.addEventListener("abort", () => {
        componentEvents.off("changed", onChanged);
      });

      await new Promise(() => {});
    });
  }
);

workspaceController.get(
  "/:workspaceId/components/:componentName/source",
  zValidator("param", componentNameParamSchema),
  async (ctx) => {
    const { workspaceId, componentName } = ctx.req.valid("param");
    const result = await getComponentSource(workspaceId, componentName);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json(result.value);
  }
);

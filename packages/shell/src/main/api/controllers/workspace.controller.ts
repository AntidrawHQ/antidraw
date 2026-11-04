import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { isComponentName } from "@/shared/utils/component-name";
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
import { publishWorkspace, type PublishEvent } from "@/main/services/publish.service";
import { readThumbnail } from "@/main/services/thumbnail.service";
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
  componentName: z.string().refine(isComponentName, "invalid component name"),
});

export type { CreateWorkspaceEvent as CreateWorkspaceResponse };

/** A publish as it goes, then how it ended. */
export type PublishStreamEvent =
  | PublishEvent
  | { type: "done"; url: string }
  | { type: "error"; code: string; message: string };

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

// The canvas as last captured, for the workspace viewer. Its URL carries the
// workspace's thumbnailVersion, so a new capture is a new URL.
workspaceController.get(
  "/:workspaceId/thumbnail",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");
    const jpeg = await readThumbnail(workspaceId);

    if (!jpeg) {
      return ctx.json({ error: { code: "NOT_FOUND", message: "No thumbnail yet" } }, 404);
    }

    return ctx.body(new Uint8Array(jpeg), 200, { "Content-Type": "image/jpeg" });
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

// Builds the workspace and publishes it to its cloud site, streaming each
// step as it goes; ends with the share page's URL, or why it couldn't.
workspaceController.post(
  "/:workspaceId/publish",
  zValidator("param", workspaceIdParamSchema),
  async (ctx) => {
    const { workspaceId } = ctx.req.valid("param");

    return streamSSE(ctx, async (stream) => {
      // In order, and none lost to a reader that went away.
      let writing = Promise.resolve();
      const write = (event: PublishStreamEvent) => {
        writing = writing.then(() => stream.writeSSE({ data: JSON.stringify(event) })).catch(() => {});
      };
      try {
        const result = await publishWorkspace(workspaceId, write);
        write(
          result.isOk()
            ? { type: "done", url: result.value.url }
            : { type: "error", code: result.error.code, message: result.error.message },
        );
      } catch (error) {
        console.error("Publish failed:", error);
        write({ type: "error", code: "INTERNAL_ERROR", message: "Something went wrong while publishing. Try again." });
      }
      await writing;
    });
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

      const onEdited = (editedWorkspaceId: string) => {
        if (editedWorkspaceId !== workspaceId) return;
        stream.writeSSE({
          data: JSON.stringify({ type: "edited" } satisfies ComponentStreamEvent),
        });
      };

      componentEvents.on("changed", onChanged);
      componentEvents.on("edited", onEdited);

      ctx.req.raw.signal.addEventListener("abort", () => {
        componentEvents.off("changed", onChanged);
        componentEvents.off("edited", onEdited);
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

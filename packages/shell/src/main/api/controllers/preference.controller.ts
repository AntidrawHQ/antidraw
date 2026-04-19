import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getGlobalPreference,
  setGlobalPreference,
  getPreference,
  setPreference,
} from "../services/preference.service";

export const preferenceController = new Hono();

const keyParamSchema = z.object({
  key: z.string().min(1),
});

const workspaceScopedParamSchema = z.object({
  workspaceId: z.string().min(1),
  key: z.string().min(1),
});

const setPreferenceSchema = z.object({
  value: z.string(),
});

// Global preferences

preferenceController.get(
  "/:key",
  zValidator("param", keyParamSchema),
  async (ctx) => {
    const { key } = ctx.req.valid("param");
    const result = await getGlobalPreference(key);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ value: result.value });
  },
);

preferenceController.put(
  "/:key",
  zValidator("param", keyParamSchema),
  zValidator("json", setPreferenceSchema),
  async (ctx) => {
    const { key } = ctx.req.valid("param");
    const { value } = ctx.req.valid("json");
    const result = await setGlobalPreference(key, value);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ ok: true });
  },
);

// Workspace-scoped preferences

preferenceController.get(
  "/:workspaceId/:key",
  zValidator("param", workspaceScopedParamSchema),
  async (ctx) => {
    const { workspaceId, key } = ctx.req.valid("param");
    const result = await getPreference(key, workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ value: result.value });
  },
);

preferenceController.put(
  "/:workspaceId/:key",
  zValidator("param", workspaceScopedParamSchema),
  zValidator("json", setPreferenceSchema),
  async (ctx) => {
    const { workspaceId, key } = ctx.req.valid("param");
    const { value } = ctx.req.valid("json");
    const result = await setPreference(key, value, workspaceId);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ ok: true });
  },
);

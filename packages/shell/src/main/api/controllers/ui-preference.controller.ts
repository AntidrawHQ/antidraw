import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getPreference,
  setPreference,
} from "../services/ui-preference.service";

export const uiPreferenceController = new Hono();

const keyParamSchema = z.object({
  key: z.string().min(1),
});

const setPreferenceSchema = z.object({
  value: z.string(),
});

uiPreferenceController.get(
  "/:key",
  zValidator("param", keyParamSchema),
  async (ctx) => {
    const { key } = ctx.req.valid("param");
    const result = await getPreference(key);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ value: result.value });
  },
);

uiPreferenceController.put(
  "/:key",
  zValidator("param", keyParamSchema),
  zValidator("json", setPreferenceSchema),
  async (ctx) => {
    const { key } = ctx.req.valid("param");
    const { value } = ctx.req.valid("json");
    const result = await setPreference(key, value);

    if (result.isErr()) {
      const { status, code, message } = result.error;
      return ctx.json({ error: { code, message } }, status);
    }

    return ctx.json({ ok: true });
  },
);

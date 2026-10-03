import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { checkHealth } from "../services/health.service";
import { respond } from "../lib/respond";

export const healthController = new Hono<AppEnv>();

healthController.get("/", (ctx) => respond(ctx, checkHealth()));

import { Hono } from "hono";
import { checkHealth } from "../services/health.service";
import { respond } from "../lib/respond";

export const healthController = new Hono();

healthController.get("/", (ctx) => respond(ctx, checkHealth()));

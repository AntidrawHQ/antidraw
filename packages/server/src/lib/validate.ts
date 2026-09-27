import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { respondError } from "./respond";

// zValidator with the error envelope: a request that fails its schema gets
// 400 INVALID_REQUEST with zod's issues in `details`, instead of the
// validator's own response body.
const validated = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, ctx) => {
    if (!result.success) {
      return respondError(ctx, 400, "INVALID_REQUEST", "Invalid request", {
        issues: result.error.issues,
      });
    }
  });

export const jsonBody = <Schema extends z.ZodType>(schema: Schema) => validated("json", schema);
export const query = <Schema extends z.ZodType>(schema: Schema) => validated("query", schema);
export const param = <Schema extends z.ZodType>(schema: Schema) => validated("param", schema);

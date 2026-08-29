import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../lib/env";
import * as schema from "./schema";

// D1 is request-scoped — the binding lives on `ctx.env`, so build the drizzle
// client per request from inside a handler: `const db = getDb(ctx.env)`.
export const getDb = (env: Bindings) => drizzle(env.DB, { schema });

export type Db = ReturnType<typeof getDb>;

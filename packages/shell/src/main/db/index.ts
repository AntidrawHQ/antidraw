import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/main/api/schema";
import { getDbPath } from "@/main/api/init"; // Triggers ~/.antidraw/ folder creation

export const client = createClient({
  url: `file:${getDbPath()}`,
});

export const db = drizzle(client, { schema });

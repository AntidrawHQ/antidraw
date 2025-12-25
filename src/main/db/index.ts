import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { app } from "electron";
import path from "path";
import * as schema from "@/main/api/schema";

const getDbPath = () => {
  // In development, use local file in src/main/db
  // In production, use app's userData directory
  if (process.env.NODE_ENV === "development") {
    return "file:./src/main/db/dev.db";
  }
  return `file:${path.join(app.getPath("userData"), "designsette.db")}`;
};

export const client = createClient({
  url: getDbPath(),
});

export const db = drizzle(client, { schema });

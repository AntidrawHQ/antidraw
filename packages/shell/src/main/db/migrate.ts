import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./index";

// SQL files are copied into dist/main/drizzle/ by the vite build (see
// electron.vite.config.ts) so this resolves the same way in dev and in the
// packaged asar.
const migrationsFolder = path.join(__dirname, "drizzle");

export const runMigrations = async () => {
  await migrate(db, { migrationsFolder });
};

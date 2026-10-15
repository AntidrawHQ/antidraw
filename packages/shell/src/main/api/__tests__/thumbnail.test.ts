import "./e2e-env"; // must stay the first import — see e2e-env.ts
import { mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/main/db";
import { workspaces } from "@/main/api/schema";
import { getWorkspacePath } from "@/main/api/init";
import { workspaceController } from "@/main/api/controllers/workspace.controller";
import { saveThumbnail } from "@/main/services/thumbnail.service";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const workspaceId = crypto.randomUUID();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(workspaces).values({ id: workspaceId, name: "thumbnail" });
  mkdirSync(getWorkspacePath(workspaceId), { recursive: true });
});

const version = async () => {
  const res = await workspaceController.request(`/${workspaceId}`);
  return (await res.json()).thumbnailVersion;
};

describe("workspace thumbnail", () => {
  test("none before the first capture", async () => {
    expect(await version()).toBeNull();
    const res = await workspaceController.request(`/${workspaceId}/thumbnail`);
    expect(res.status).toBe(404);
  });

  test("a capture is served as saved, with a version in the workspace and its list", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await saveThumbnail(workspaceId, jpeg);

    const res = await workspaceController.request(`/${workspaceId}/thumbnail`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg);

    const saved = await version();
    expect(typeof saved).toBe("number");
    const list = await (await workspaceController.request("/")).json();
    expect(list.find((w: { id: string }) => w.id === workspaceId).thumbnailVersion).toBe(saved);
  });

  test("a new capture replaces it whole, leaving no temp file", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 9, 9]);
    await saveThumbnail(workspaceId, jpeg);

    const res = await workspaceController.request(`/${workspaceId}/thumbnail`);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg);
    expect(readdirSync(getWorkspacePath(workspaceId))).toEqual(["thumbnail.jpg"]);
  });
});

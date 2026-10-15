import fs from "node:fs/promises";
import { getWorkspaceThumbnailPath } from "@/main/api/init";

// A workspace's thumbnail: its canvas as the main window last showed it
// (main.ts's "thumbnail:capture"), for the workspace viewer. One file a
// workspace, at a path its id gives; its mtime is its version.

export const saveThumbnail = async (workspaceId: string, jpeg: Buffer) => {
  const file = getWorkspaceThumbnailPath(workspaceId);
  // Renamed into place, so a read never sees half an image; a name of its
  // own, so two captures at once don't write the same file.
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, jpeg);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
};

// The image, or null before the first capture.
export const readThumbnail = async (workspaceId: string) =>
  fs.readFile(getWorkspaceThumbnailPath(workspaceId)).catch(() => null);

// For the viewer's ?v=: a new one each capture. Null before the first.
export const getThumbnailVersion = async (workspaceId: string) => {
  try {
    const { mtimeMs } = await fs.stat(getWorkspaceThumbnailPath(workspaceId));
    return Math.round(mtimeMs);
  } catch {
    return null;
  }
};
